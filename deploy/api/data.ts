/**
 * Live data endpoint for the deployed map. On each (cached) request:
 *   - pulls current events from every Parallel monitor
 *   - pulls active NWS alerts for the monitored states, filtered to each
 *     metro's core counties via SAME geocodes
 *   - merges with build-time statics (metros, market intel, surge briefs,
 *     last local scorecard) from _static.json
 *
 * Responses are CDN-cached for 5 minutes (s-maxage) so the Parallel API is
 * hit at most once per cache window, not per viewer.
 */

import staticData from "./_static.json";

const PARALLEL_BASE = "https://api.parallel.ai";

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

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

async function fetchMonitorEvents(apiKey: string) {
  const results = await pool(staticData.monitors, 20, async (m: any) => {
    try {
      const res = await fetch(`${PARALLEL_BASE}/v1/monitors/${m.monitorId}/events`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) return [];
      const events = (await res.json()).events || [];
      return events.map((evt: any) => {
        const c = evt.output?.content ?? {};
        const published = Date.parse(c.published_at ?? "");
        const firstSeen = !isNaN(published)
          ? new Date(published).toISOString()
          : evt.event_date
            ? new Date(evt.event_date + "T12:00:00Z").toISOString()
            : new Date().toISOString();
        return {
          id: evt.event_id,
          metro: m.metroId,
          config: m.config,
          type: c.event_type ?? m.eventType ?? "other",
          severity: c.severity ?? "advisory",
          headline: c.headline ?? "(no headline)",
          geography: c.geography ?? "",
          onset: c.onset ?? "",
          duration: c.expected_duration ?? "",
          demand: c.demand_signal ?? "",
          publishedAt: c.published_at ?? "",
          nwsRef: c.nws_reference ?? "",
          sources: String(c.source_urls ?? "")
            .split(/[,\s]+/)
            .filter((u: string) => u.startsWith("http")),
          firstSeen,
        };
      });
    } catch {
      return [];
    }
  });
  return results.flat();
}

async function fetchNwsAlerts() {
  const areas = [...new Set(staticData.metros.flatMap((m: any) => m.nwsArea))].join(",");
  try {
    const res = await fetch(
      `https://api.weather.gov/alerts/active?area=${areas}`,
      { headers: { "User-Agent": "avoca-weather-demo (ruthvik@parallel.ai)", Accept: "application/geo+json" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const now = Date.now();
    const alerts: any[] = [];
    for (const f of data.features || []) {
      const p = f.properties;
      const same: string[] = p.geocode?.SAME || [];
      const metros = staticData.metros
        .filter((m: any) => m.sameCodes.some((c: string) => same.includes(c)))
        .map((m: any) => m.id);
      if (!metros.length) continue;
      alerts.push({
        id: p.id,
        metros,
        event: p.event,
        category: categorize(p.event || ""),
        severity: p.severity,
        sent: p.sent,
        ends: p.ends || p.expires || null,
        headline: p.headline || p.event,
        areaDesc: p.areaDesc,
        active: new Date(p.ends || p.expires || 0).getTime() > now,
      });
    }
    return alerts;
  } catch {
    return [];
  }
}

export default async function handler(req: any, res: any) {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "PARALLEL_API_KEY not configured" });
    return;
  }

  const [events, alerts] = await Promise.all([
    fetchMonitorEvents(apiKey),
    fetchNwsAlerts(),
  ]);
  events.sort(
    (a: any, b: any) => new Date(b.firstSeen).getTime() - new Date(a.firstSeen).getTime()
  );

  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({
    generatedAt: new Date().toISOString(),
    fleet: staticData.fleet,
    scorecard: staticData.scorecard,
    metros: staticData.metros,
    events,
    alerts,
    market: staticData.market,
    briefs: staticData.briefs,
  });
}
