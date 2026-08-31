/**
 * Scores narrow vs. wide monitor configs against NWS ground truth.
 *
 * For each trades-relevant NWS alert (category != irrelevant), asks: did
 * each config produce a matching event (same metro, compatible event class,
 * detected within the alert's active window ± slack)?
 *
 *   recall   = matched ground-truth alerts / all ground-truth alerts
 *   latency  = firstSeenAt − alert.sent (median + p90, per config)
 *   noise    = monitor events matching no ground-truth alert, split into
 *              "non-NWS but demand-relevant" (outages, declarations — only
 *              the wide config can even produce these) vs. "unmatched"
 *
 * Usage: npx tsx scripts/score.ts [--json out.json]
 */

import * as fs from "fs";
import * as path from "path";

const DATA = path.join(__dirname, "..", "data");

// monitor-output event_type → ground-truth category
const TYPE_TO_CATEGORY: Record<string, string> = {
  freeze: "freeze",
  heat_wave: "heat",
  severe_storm: "storm",
  tropical_system: "storm",
  flood: "flood",
};

const MATCH_SLACK_MS = 6 * 3600_000; // allow detection up to 6h after alert expires

function readJsonl(p: string): any[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

function fmtMin(ms: number | null): string {
  return ms === null ? "—" : `${Math.round(ms / 60000)} min`;
}

function main() {
  const alerts = readJsonl(path.join(DATA, "nws-alerts.jsonl"));
  const events = readJsonl(path.join(DATA, "events.jsonl"));

  const relevant = alerts.filter((a) => a.category !== "irrelevant");

  // Latency is only meaningful for alerts issued after the fleet existed —
  // pre-existing alerts get "detected" on the first execution regardless.
  const monitors = JSON.parse(
    fs.readFileSync(path.join(DATA, "monitors.json"), "utf-8")
  );
  const fleetCreatedAt = Math.min(
    ...(Object.values(monitors) as any[]).map((m) =>
      new Date(m.createdAt).getTime()
    )
  );

  const results: any = { generatedAt: new Date().toISOString(), configs: {} };

  for (const config of ["narrow", "wide"]) {
    const evts = events.filter((e) => e.config === config);
    const matchedAlertIds = new Set<string>();
    const latencies: number[] = [];
    const matchedEventIds = new Set<string>();

    for (const a of relevant) {
      const sent = new Date(a.sent).getTime();
      const windowEnd =
        new Date(a.ends || a.expires || a.sent).getTime() + MATCH_SLACK_MS;

      const candidates = evts.filter((e) => {
        if (!a.metros.includes(e.metroId)) return false;
        const evtType =
          e.raw?.output?.content?.event_type ?? e.narrowEventType ?? "";
        const cat = TYPE_TO_CATEGORY[evtType] ?? e.narrowEventType ?? "";
        if (cat !== a.category) return false;
        const seen = new Date(e.firstSeenAt).getTime();
        return seen >= sent - 3600_000 && seen <= windowEnd;
      });

      if (candidates.length) {
        matchedAlertIds.add(a.id);
        if (sent >= fleetCreatedAt) {
          const earliest = Math.min(
            ...candidates.map((e) => new Date(e.firstSeenAt).getTime())
          );
          latencies.push(Math.max(0, earliest - sent));
        }
        candidates.forEach((e) => matchedEventIds.add(e.eventId));
      }
    }

    const unmatched = evts.filter((e) => !matchedEventIds.has(e.eventId));
    const nonNwsRelevant = unmatched.filter((e) => {
      const t = e.raw?.output?.content?.event_type;
      return t === "power_outage" || t === "emergency_declaration";
    });

    results.configs[config] = {
      totalEvents: evts.length,
      groundTruthAlerts: relevant.length,
      matchedAlerts: matchedAlertIds.size,
      recall: relevant.length
        ? +(matchedAlertIds.size / relevant.length).toFixed(3)
        : null,
      latencySamples: latencies.length,
      latencyMedianMs: quantile(latencies, 0.5),
      latencyP90Ms: quantile(latencies, 0.9),
      unmatchedEvents: unmatched.length,
      nonNwsDemandRelevant: nonNwsRelevant.length,
      pureNoise: unmatched.length - nonNwsRelevant.length,
    };
  }

  console.log(`Ground truth: ${relevant.length} trades-relevant NWS alerts (${alerts.length} logged total)\n`);
  for (const [config, r] of Object.entries(results.configs) as [string, any][]) {
    console.log(`${config.toUpperCase()}`);
    console.log(`  events: ${r.totalEvents}`);
    console.log(`  recall: ${r.matchedAlerts}/${r.groundTruthAlerts} = ${r.recall ?? "—"}`);
    console.log(
      `  latency vs NWS sent (post-creation alerts only, n=${r.latencySamples}): median ${fmtMin(r.latencyMedianMs)}, p90 ${fmtMin(r.latencyP90Ms)}`
    );
    console.log(`  non-NWS demand-relevant (outages/declarations): ${r.nonNwsDemandRelevant}`);
    console.log(`  pure noise: ${r.pureNoise}\n`);
  }

  const jsonIdx = process.argv.indexOf("--json");
  if (jsonIdx >= 0) {
    const outPath = process.argv[jsonIdx + 1] || path.join(DATA, "scorecard.json");
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`Scorecard → ${outPath}`);
  }
}

main();
