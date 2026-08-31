/**
 * Surge briefs: Monitor → Task API chaining. For each metro with a live
 * warning-level event (or any active event with --include-advisories), a
 * Task API run turns the raw weather event into a dispatch-ready playbook:
 * expected call mix, staffing actions, and an outbound hook — the concrete
 * "what Avoca's product does with 12 hours of warning."
 *
 * Usage:
 *   npx tsx scripts/surge-brief.ts [--include-advisories]   # submit + wait + save
 */

import * as fs from "fs";
import * as path from "path";
import { METROS } from "./metros";

const API_KEY = process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";
const DATA = path.join(__dirname, "..", "data");
const OUT_PATH = path.join(DATA, "surge-briefs.json");

const BRIEF_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      headline: { type: "string" as const, description: "One line naming the surge, under 90 chars" },
      situation: {
        type: "string" as const,
        description: "2-3 sentences: what is happening, when it peaks, with specific temperatures/timings from sources",
      },
      call_forecast: {
        type: "string" as const,
        description:
          "Expected inbound call mix by trade with relative volume, e.g. 'HVAC no-cool calls 2-3x baseline from Fri afternoon; electrical panel/breaker calls elevated evenings'",
      },
      staffing_playbook: {
        type: "string" as const,
        description:
          "3-4 concrete CSR/dispatch actions in priority order: AI overflow pre-arm, extended staffed hours, emergency-slot reservation, triage script changes",
      },
      outbound_hook: {
        type: "string" as const,
        description:
          "1-2 sentence outbound message to maintenance-plan members that defends booked-call rate before the surge (preventive framing, priority-service offer)",
      },
      priority_areas: {
        type: "string" as const,
        description: "Sub-areas of the metro likely hit hardest, from the event geography and sources",
      },
      peak_window: { type: "string" as const, description: "When call volume most likely peaks, as a concrete time window" },
    },
    required: [
      "headline", "situation", "call_forecast",
      "staffing_playbook", "outbound_hook", "priority_areas", "peak_window",
    ],
    additionalProperties: false,
  },
};

function readJsonl(p: string): any[] {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function main() {
  const includeAdvisories = process.argv.includes("--include-advisories");
  if (!API_KEY) throw new Error("PARALLEL_API_KEY not set");

  const events = readJsonl(path.join(DATA, "events.jsonl"));
  const byMetro: Record<string, any[]> = {};
  for (const e of events) {
    const c = e.raw?.output?.content;
    if (!c) continue;
    (byMetro[e.metroId] ||= []).push({ config: e.config, firstSeen: e.firstSeenAt, ...c });
  }

  const targets = Object.entries(byMetro).filter(([, evts]) =>
    evts.some((e) => e.severity === "warning" || e.severity === "emergency" ||
      (includeAdvisories && e.severity === "advisory"))
  );

  const out: Record<string, any> = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"))
    : {};

  console.log(`Generating surge briefs for ${targets.length} metros...`);
  const submissions: { metroId: string; runId: string }[] = [];
  for (const [metroId, evts] of targets) {
    if (out[metroId] && !process.argv.includes("--regenerate")) {
      console.log(`  - ${metroId} already briefed, skipping (--regenerate to refresh)`);
      continue;
    }
    const m = METROS.find((x) => x.id === metroId)!;
    const evtSummaries = evts
      .sort((a, b) => (b.severity === "warning" ? 1 : 0) - (a.severity === "warning" ? 1 : 0))
      .slice(0, 4)
      .map((e) => JSON.stringify({
        headline: e.headline, severity: e.severity, geography: e.geography,
        onset: e.onset, duration: e.expected_duration, demand: e.demand_signal,
      }));
    const input =
      `You are preparing a surge brief for a residential trades (HVAC/plumbing/electrical) call-center ` +
      `operation in the ${m.name} metro area (${m.counties}). The following demand-relevant weather events ` +
      `were just detected by monitors:\n\n${evtSummaries.join("\n")}\n\n` +
      `Verify current conditions and forecasts against live sources (NWS, local news), then produce a ` +
      `dispatch-ready surge brief. Be specific with temperatures, timing, and sub-areas. Frame everything ` +
      `around protecting booked call rate: the call center must not miss the surge.`;

    const res = await fetch(`${BASE_URL}/v1/tasks/runs`, {
      method: "POST",
      headers: { "x-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        task_spec: { output_schema: BRIEF_SCHEMA },
        processor: "core",
        metadata: { demo: "avoca-weather", kind: "surge-brief", metro: metroId },
      }),
    });
    if (!res.ok) { console.error(`  ✗ ${metroId}: ${res.status} ${await res.text()}`); continue; }
    const data = await res.json();
    submissions.push({ metroId, runId: data.run_id });
    console.log(`  → ${metroId}: ${data.run_id}`);
  }

  // Wait for results (core runs are quick)
  for (const s of submissions) {
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${BASE_URL}/v1/tasks/runs/${s.runId}/result`, {
        headers: { "x-api-key": API_KEY },
      });
      if (res.ok) {
        const data = await res.json();
        out[s.metroId] = {
          content: data.output?.content,
          generatedAt: new Date().toISOString(),
          runId: s.runId,
        };
        fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
        console.log(`  ✓ ${s.metroId} brief ready`);
        break;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  console.log(`Briefs → ${OUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
