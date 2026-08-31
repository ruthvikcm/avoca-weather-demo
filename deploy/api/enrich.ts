/**
 * Caller enrichment pipeline — phone number to street-level home + property.
 *
 * Runs the three stages that produce the enriched-caller field set:
 *
 *   1. identity   reverse phone lookup against the contact-data provider
 *                 (name, title, employer, emails, phones, LinkedIn)
 *                                                               [~1s, sync]
 *   2. addresses  Parallel Task run — MULTI-CANDIDATE ranked addresses at
 *                 street level, steered at people-search + assessor sources,
 *                 each labeled address_type / confidence / as_of / evidence
 *                 (multi-candidate address research)
 *   3. property   Parallel Task run on the top residential candidate — beds,
 *                 baths, sqft, lot, year built, stories, last sale, estimated
 *                 and assessed value, tax, APN, HOA
 *                 (property-record research)
 *
 * Wire protocol (the client drives the chain, nothing is stored server-side):
 *   POST /api/enrich {phone, processor}      → {person, addressRunId}
 *   GET  /api/enrich?runId=…&kind=addresses  → {status, identityMatch,
 *                                               addresses[], map[]}
 *   POST /api/enrich {address}               → {propertyRunId}
 *   GET  /api/enrich?runId=…&kind=property   → {status, property}
 *
 * Residential address and property data are PII about real people. Stage 2
 * keeps the pipeline's disambiguation guardrails (exclude same-name
 * individuals, never fabricate an address, label unconfirmed candidates as
 * such) and the endpoint is gated by ENRICH_TOKEN.
 */

import { geoAlbersUsa } from "d3-geo";

const PARALLEL_BASE = "https://api.parallel.ai";
const IDENTITY_LOOKUP_URL =
  process.env.IDENTITY_LOOKUP_URL ||
  "https://api.rocketreach.co/api/v2/universal/person/lookup";
const MIN_ADDRESSES = 5;

/* ------------------------------------------------------------------ */
/* Stage 2 — ranked candidate addresses                                */
/* ------------------------------------------------------------------ */

const PERSON_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    name: { type: "string", description: "Full name of the person." },
    linkedin_url: { type: "string", description: "LinkedIn profile URL." },
    current_title: { type: "string", description: "Current job title." },
    current_employer: { type: "string", description: "Current employer." },
    stated_location: {
      type: "string",
      description: "Location the person publicly lists (city/region/country).",
    },
    phone: { type: "string", description: "Known phone number for the person." },
    birth_year: { type: "string", description: "Birth year, if known." },
    known_locations: {
      type: "array",
      items: { type: "string" },
      description: "Cities/regions historically associated with the person.",
    },
    education: { type: "array", items: { type: "string" }, description: "Schools attended." },
    other_profile_urls: {
      type: "array",
      items: { type: "string" },
      description: "Other social/profile URLs for disambiguation.",
    },
  },
};

const ADDRESSES_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    identity_match: {
      type: "string",
      description:
        "How confidently the researched person matches the input identity, and on what basis (LinkedIn slug, employer, education). Note any same-name individuals that were excluded.",
    },
    addresses: {
      type: "array",
      description:
        `At least ${MIN_ADDRESSES} distinct candidate addresses associated with this specific person, ordered from most to least likely to be their CURRENT home. Include current and former residences, household/relative addresses, and business/mailing addresses. INCLUDE low-confidence and unconfirmed candidates (label them as such) rather than omitting them, but never invent an address that has no source. If fewer than ${MIN_ADDRESSES} real candidates exist, return only the real ones.`,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          full_address: { type: "string", description: "Full single-line address as found." },
          street: {
            type: "string",
            description:
              "Street number and name, including any unit/apt number. This must be the actual street line — do not return a city-only value here.",
          },
          city: { type: "string" },
          state_or_region: { type: "string" },
          postal_code: { type: "string" },
          country: { type: "string" },
          address_type: {
            type: "string",
            description:
              "One of: 'current_residential', 'former_residential', 'household_or_relative', 'business_or_mailing', 'po_box', or 'unconfirmed'.",
          },
          confidence: {
            type: "string",
            description: "high | medium | low — confidence this address belongs to the target person.",
          },
          as_of: {
            type: "string",
            description: "Recency/date the source associates with this address, if any (else empty).",
          },
          source_name: {
            type: "string",
            description: "Source site/record type (e.g. Whitepages, county property records, FastPeopleSearch).",
          },
          source_url: { type: "string", description: "Source URL." },
          evidence: {
            type: "string",
            description: "Why this address is linked to the person, and any caveats.",
          },
        },
        required: [
          "full_address", "street", "city", "state_or_region", "postal_code",
          "country", "address_type", "confidence", "as_of", "source_name",
          "source_url", "evidence",
        ],
      },
    },
  },
  required: ["identity_match", "addresses"],
};

const ADDRESSES_INSTRUCTIONS =
  `Compile a list of at least ${MIN_ADDRESSES} distinct physical addresses associated with the SPECIFIC person ` +
  "described by the input attributes. First disambiguate the person using the LinkedIn URL, employer, title, " +
  "known locations, education, and other profile URLs, and exclude same-name individuals. Search people-search " +
  "and property-record sources (Whitepages, FastPeopleSearch, TruePeopleSearch, SearchPeopleFree, Spokeo, " +
  "InstantCheckmate, county property/assessor records, voter records, LLC filings) as well as professional/social " +
  "profiles. Return STREET-LEVEL addresses including unit numbers — a city-only answer is not useful here. " +
  "Return current and former residences, household/relative addresses, and business/mailing addresses. Label each " +
  "with address_type and confidence, and INCLUDE low-confidence or unconfirmed candidates (marked accordingly) " +
  "rather than dropping them. Never fabricate an address that has no supporting source. Order the list from most " +
  "to least likely to be the person's current home.";

/* ------------------------------------------------------------------ */
/* Stage 3 — property details                                          */
/* ------------------------------------------------------------------ */

const PROPERTY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    property_found: {
      type: "string",
      description: "yes | no — whether a public real-estate/assessor record for THIS specific address was located.",
    },
    property_type: {
      type: "string",
      description: "Single Family, Condo, Townhouse, Multi-Family, Apartment, Mobile/Manufactured, Land, or Unknown.",
    },
    bedrooms: { type: "string", description: "Number of bedrooms. Empty if unknown." },
    bathrooms: { type: "string", description: "Number of bathrooms (may be fractional, e.g. 2.5). Empty if unknown." },
    square_footage: { type: "string", description: "Interior living area in sqft. Empty if unknown." },
    lot_size: { type: "string", description: "Lot size with unit (sqft or acres). Empty if unknown." },
    year_built: { type: "string", description: "Year the home was built. Empty if unknown." },
    stories: { type: "string", description: "Number of stories/floors. Empty if unknown." },
    last_sold_date: { type: "string", description: "Most recent sale date. Empty if unknown." },
    last_sold_price: { type: "string", description: "Most recent sale price (USD). Empty if unknown." },
    estimated_value: {
      type: "string",
      description: "Current estimated market value (Zestimate/Redfin Estimate) with source. Empty if unknown.",
    },
    assessed_value: { type: "string", description: "Tax-assessed value from the county assessor. Empty if unknown." },
    annual_property_tax: { type: "string", description: "Annual property tax amount (USD). Empty if unknown." },
    parcel_apn: { type: "string", description: "Assessor parcel number (APN), if available. Empty if unknown." },
    hoa_fee: { type: "string", description: "HOA fee with cadence, if applicable. Empty if unknown/none." },
    hvac_system: {
      type: "string",
      description:
        "Heating and cooling system as described by listing/assessor records (e.g. 'forced air gas furnace, central AC'), including age or install year if reported. Empty if unknown.",
    },
    sources: {
      type: "string",
      description:
        "Which sources the attributes came from (e.g. Zillow, Redfin, county assessor), and any caveats about staleness or unit-level ambiguity.",
    },
  },
  required: [
    "property_found", "property_type", "bedrooms", "bathrooms", "square_footage",
    "lot_size", "year_built", "stories", "last_sold_date", "last_sold_price",
    "estimated_value", "assessed_value", "annual_property_tax", "parcel_apn",
    "hoa_fee", "hvac_system", "sources",
  ],
};

const PROPERTY_INSTRUCTIONS =
  "Research the physical characteristics of the specific residential property at the given street address. Use " +
  "public real-estate listings and public records: Zillow, Redfin, Realtor.com, Trulia, and the county assessor / " +
  "property-appraiser database. Return the building's attributes (beds, baths, square footage, lot size, year " +
  "built, stories), the heating/cooling system if reported, the most recent sale, and current estimated / assessed " +
  "value. Match the EXACT address including any unit/apartment number. If the address is an apartment/condo unit, " +
  "report the unit's attributes when available, otherwise the building's. Never fabricate figures — leave a field " +
  "empty if no reliable source provides it, and set property_found to 'no' if the address cannot be found at all.";

/* ------------------------------------------------------------------ */

function toE164(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return "+" + digits;
}

function personFromIdentityProfile(profile: any) {
  const known: string[] = [];
  if (profile.location) known.push(String(profile.location));
  for (const job of profile.job_history || []) {
    if (job && typeof job === "object") {
      const loc = [job.company_city, job.company_region, job.company_country_code].filter(Boolean).join(", ");
      if (loc) known.push(loc);
    }
  }
  const education: string[] = [];
  for (const edu of profile.education || []) {
    if (edu && edu.school) {
      const degree = edu.degree || edu.major;
      education.push(degree ? `${edu.school} (${degree})` : String(edu.school));
    }
  }
  const links =
    profile.links && typeof profile.links === "object" ? Object.values(profile.links).filter(Boolean) : [];
  const dedupe = (xs: string[]) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];

  const emails = dedupe(
    (profile.emails || []).map((e: any) => (typeof e === "string" ? e : e?.email)).filter(Boolean)
  );
  const phones = dedupe(
    (profile.phones || []).map((p: any) => (typeof p === "string" ? p : p?.number)).filter(Boolean)
  );

  return {
    name: profile.name ?? null,
    linkedin_url: profile.linkedin_url ?? null,
    current_title: profile.current_title ?? null,
    current_employer: profile.current_employer ?? null,
    location: profile.location ?? null,
    birth_year: profile.birth_year ?? null,
    recommended_email: profile.recommended_professional_email || profile.recommended_email || emails[0] || null,
    emails,
    phones,
    known_locations: dedupe(known),
    education: dedupe(education),
    other_profile_urls: links as string[],
  };
}

function toTaskInput(p: ReturnType<typeof personFromIdentityProfile>, phone: string) {
  const input: Record<string, unknown> = { _objective: ADDRESSES_INSTRUCTIONS };
  if (p.name) input.name = p.name;
  if (p.linkedin_url) input.linkedin_url = p.linkedin_url;
  if (p.current_title) input.current_title = p.current_title;
  if (p.current_employer) input.current_employer = p.current_employer;
  if (p.location) input.stated_location = p.location;
  if (phone) input.phone = phone;
  if (p.birth_year) input.birth_year = String(p.birth_year);
  if (p.known_locations.length) input.known_locations = p.known_locations;
  if (p.education.length) input.education = p.education;
  if (p.other_profile_urls.length) input.other_profile_urls = p.other_profile_urls;
  return input;
}

const hasStreetNumber = (street: string) =>
  /^\s*\d+\s+\w/.test(street || "") && !/not |redacted|unspecified/i.test(street || "");

async function createRun(apiKey: string, body: unknown) {
  const res = await fetch(`${PARALLEL_BASE}/v1/tasks/runs`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 202 && !res.ok) {
    throw new Error(`task create failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()).run_id as string;
}

async function geocodeOne(a: any): Promise<{ lat: number; lon: number; precision: string } | null> {
  try {
    if (hasStreetNumber(a.street) && a.city) {
      const oneline = [a.street, a.city, a.state_or_region, a.postal_code].filter(Boolean).join(", ");
      const res = await fetch(
        "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" +
          new URLSearchParams({ address: oneline, benchmark: "Public_AR_Current", format: "json" })
      );
      if (res.ok) {
        const m = (await res.json()).result?.addressMatches?.[0];
        if (m) return { lat: m.coordinates.y, lon: m.coordinates.x, precision: "street" };
      }
    }
    if (a.city) {
      const res = await fetch(
        "https://geocoding-api.open-meteo.com/v1/search?" +
          new URLSearchParams({ name: a.city, count: "5", language: "en", format: "json" })
      );
      if (res.ok) {
        const results = (await res.json()).results || [];
        const want = String(a.state_or_region || "").toLowerCase();
        const hit =
          results.find((r: any) => (r.admin1 || "").toLowerCase().startsWith(want.slice(0, 2)) && r.country_code === "US") ||
          results.find((r: any) => r.country_code === "US") ||
          results[0];
        if (hit) return { lat: hit.latitude, lon: hit.longitude, precision: "city" };
      }
    }
  } catch {}
  return null;
}

const projXY = (lon: number, lat: number) => {
  const xy = geoAlbersUsa().scale(1300).translate([487.5, 305])([lon, lat]);
  return xy ? { x: +xy[0].toFixed(1), y: +xy[1].toFixed(1) } : null;
};

function authorized(req: any): boolean {
  const token = process.env.ENRICH_TOKEN;
  if (!token) return true; // unset → open (local/dev)
  const supplied = req.headers?.["x-enrich-token"] || req.query?.token || req.body?.token;
  return supplied === token;
}

export default async function handler(req: any, res: any) {
  const parallelKey = process.env.PARALLEL_API_KEY;
  const identityKey = process.env.IDENTITY_API_KEY;
  res.setHeader("Cache-Control", "no-store");

  if (!authorized(req)) {
    res.status(401).json({ error: "enrichment token required" });
    return;
  }

  try {
    /* ---------------- POST: start a stage ---------------- */
    if (req.method === "POST") {
      if (!parallelKey) throw new Error("PARALLEL_API_KEY not configured");

      // Stage 3 kickoff — property details for one chosen address
      if (req.body?.address) {
        const propertyRunId = await createRun(parallelKey, {
          processor: req.body.processor === "pro" ? "pro" : "core",
          input: { _objective: PROPERTY_INSTRUCTIONS, address: String(req.body.address) },
          task_spec: { output_schema: { type: "json", json_schema: PROPERTY_OUTPUT_SCHEMA } },
          metadata: { pipeline: "property_details_enrichment", demo: "avoca-weather" },
        });
        res.status(200).json({ propertyRunId });
        return;
      }

      // Stage 1 + 2 kickoff — identity, then ranked addresses
      if (!identityKey) throw new Error("IDENTITY_API_KEY not configured");
      const phone = String(req.body?.phone || "").trim();
      if (phone.replace(/\D/g, "").length < 10) {
        res.status(400).json({ error: "valid phone number required" });
        return;
      }

      const idRes = await fetch(
        `${IDENTITY_LOOKUP_URL}?` +
          new URLSearchParams({
            phone: toE164(phone),
            reveal_professional_email: "true",
            reveal_personal_email: "true",
            return_cached_emails: "true",
            reveal_phone: "true",
          }),
        { headers: { "Api-Key": identityKey, Accept: "application/json", "User-Agent": "avoca-caller-lookup/1.0" } }
      );
      if (!idRes.ok) {
        res.status(502).json({
          error: `identity lookup failed (${idRes.status})`,
          detail: (await idRes.text()).slice(0, 200),
        });
        return;
      }
      const person = personFromIdentityProfile(await idRes.json());
      if (!person.name) {
        res.status(404).json({ error: "no person found for that phone number" });
        return;
      }

      const addressRunId = await createRun(parallelKey, {
        processor: req.body?.processor === "pro" ? "pro" : "core",
        input: toTaskInput(person, toE164(phone)),
        task_spec: {
          input_schema: { type: "json", json_schema: PERSON_INPUT_SCHEMA },
          output_schema: { type: "json", json_schema: ADDRESSES_OUTPUT_SCHEMA },
        },
        metadata: { pipeline: "home_address_enrichment", demo: "avoca-weather" },
      });

      res.status(200).json({
        addressRunId,
        phone: toE164(phone),
        person: {
          name: person.name,
          title: person.current_title,
          employer: person.current_employer,
          location: person.location,
          linkedin: person.linkedin_url,
          recommendedEmail: person.recommended_email,
          emails: person.emails,
          phones: person.phones,
          education: person.education,
        },
      });
      return;
    }

    /* ---------------- GET: poll a stage ---------------- */
    if (req.method === "GET") {
      if (!parallelKey) throw new Error("PARALLEL_API_KEY not configured");
      const runId = String(req.query?.runId || "");
      const kind = String(req.query?.kind || "addresses");
      if (!/^trun_[a-z0-9]+$/i.test(runId)) {
        res.status(400).json({ error: "runId required" });
        return;
      }

      const r = await fetch(`${PARALLEL_BASE}/v1/tasks/runs/${runId}/result?timeout=20`, {
        headers: { "x-api-key": parallelKey },
      });
      if (r.status === 408) { res.status(200).json({ status: "running" }); return; }
      if (!r.ok) {
        res.status(200).json({ status: r.status === 404 ? "failed" : "running", httpStatus: r.status });
        return;
      }
      const data = await r.json();
      const content = data.output?.content ?? {};

      if (kind === "property") {
        // The schema says "empty if unknown", but the model sometimes writes
        // prose instead ("Not reported in the available records; public facts
        // show — baths."). Normalize so the UI can rely on truthiness.
        for (const k of Object.keys(content)) {
          if (k === "property_found" || k === "sources") continue;
          const v = content[k];
          if (typeof v === "string" && /^(not\s|no\s|unknown|n\/a|none\b|—|-)/i.test(v.trim())) {
            content[k] = "";
          }
        }
        res.status(200).json({ status: "completed", property: content, runId });
        return;
      }

      // addresses: rank, geocode, project — street-level candidates first
      const raw: any[] = Array.isArray(content.addresses) ? content.addresses : [];
      const addresses = await Promise.all(
        raw.map(async (a, i) => {
          const geo = await geocodeOne(a);
          return {
            rank: i + 1,
            full_address: a.full_address ?? "",
            street: a.street ?? "",
            city: a.city ?? "",
            state: a.state_or_region ?? "",
            postal_code: a.postal_code ?? "",
            country: a.country ?? "",
            address_type: a.address_type ?? "unconfirmed",
            confidence: a.confidence ?? "",
            as_of: a.as_of ?? "",
            source_name: a.source_name ?? "",
            source_url: a.source_url ?? "",
            evidence: a.evidence ?? "",
            street_level: hasStreetNumber(a.street ?? ""),
            geo,
            map: geo ? { ...projXY(geo.lon, geo.lat), precision: geo.precision } : null,
          };
        })
      );

      res.status(200).json({
        status: "completed",
        runId,
        identityMatch: content.identity_match ?? "",
        addresses,
      });
      return;
    }

    res.status(405).json({ error: "method not allowed" });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
