/**
 * Ground truth: official NWS alerts for the 10 metros, straight from
 * api.weather.gov. Every alert carries a `sent` timestamp — that is the
 * latency baseline monitors are measured against.
 *
 * Filters alerts to each metro's core counties via SAME geocodes, tags each
 * with our event-type taxonomy, and appends to data/nws-alerts.jsonl
 * (deduped by alert id; re-running is safe).
 *
 * Usage:
 *   npx tsx scripts/nws-ground-truth.ts            # active alerts now
 *   npx tsx scripts/nws-ground-truth.ts --history 3  # last 3 days
 */

import * as fs from "fs";
import * as path from "path";
import { METROS } from "./metros";

const OUT_PATH = path.join(__dirname, "..", "data", "nws-alerts.jsonl");
const UA = "avoca-weather-demo (ruthvik@parallel.ai)";

// NWS `event` name → our taxonomy. Alerts not matching any class (rip
// current, air quality, red flag, ...) are logged with category "irrelevant"
// and excluded from the recall denominator.
const CATEGORY_PATTERNS: [RegExp, string][] = [
  [/freeze|hard freeze|extreme cold|wind chill|winter storm|winter weather|ice storm|blizzard|cold weather|frost/i, "freeze"],
  [/heat/i, "heat"],
  [/thunderstorm|tornado|high wind|wind advisory|extreme wind|hurricane|tropical storm|storm warning/i, "storm"],
  [/flood|storm surge|hydrologic/i, "flood"],
];

function categorize(event: string): string {
  for (const [re, cat] of CATEGORY_PATTERNS) if (re.test(event)) return cat;
  return "irrelevant";
}

function metrosForAlert(sameCodes: string[]): string[] {
  const hit = new Set<string>();
  for (const m of METROS) {
    if (m.sameCodes.some((c) => sameCodes.includes(c))) hit.add(m.id);
  }
  return [...hit];
}

async function fetchAlerts(params: string): Promise<any[]> {
  const features: any[] = [];
  let url = `https://api.weather.gov/alerts?${params}&limit=500`;
  for (let page = 0; page < 20 && url; page++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/geo+json" } });
    if (!res.ok) throw new Error(`NWS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    features.push(...(data.features || []));
    url = data.pagination?.next && (data.features || []).length === 500 ? data.pagination.next : "";
  }
  return features;
}

async function main() {
  const histIdx = process.argv.indexOf("--history");
  const areas = [...new Set(METROS.flatMap((m) => m.nwsArea))].join(",");

  let params: string;
  if (histIdx >= 0) {
    const days = Number(process.argv[histIdx + 1] || 3);
    const start = new Date(Date.now() - days * 86400_000).toISOString();
    params = `start=${encodeURIComponent(start)}&area=${areas}`;
  } else {
    params = `active=true&area=${areas}`;
  }

  const features = await fetchAlerts(params);

  const seen = new Set<string>();
  if (fs.existsSync(OUT_PATH)) {
    for (const line of fs.readFileSync(OUT_PATH, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try { seen.add(JSON.parse(line).id); } catch {}
    }
  }

  let added = 0, matched = 0;
  const out = fs.createWriteStream(OUT_PATH, { flags: "a" });
  for (const f of features) {
    const p = f.properties;
    const same: string[] = p.geocode?.SAME || [];
    const metros = metrosForAlert(same);
    if (metros.length === 0) continue; // outside our core counties
    matched++;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    added++;
    out.write(
      JSON.stringify({
        id: p.id,
        event: p.event,
        category: categorize(p.event || ""),
        metros,
        severity: p.severity,
        urgency: p.urgency,
        sent: p.sent,
        effective: p.effective,
        onset: p.onset,
        ends: p.ends,
        expires: p.expires,
        areaDesc: p.areaDesc,
        headline: p.headline,
        loggedAt: new Date().toISOString(),
      }) + "\n"
    );
  }
  out.end();
  console.log(
    `Fetched ${features.length} alerts for [${areas}]; ${matched} touch our metros; ${added} new → ${OUT_PATH}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
