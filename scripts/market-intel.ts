/**
 * Per-metro trades-market intelligence via the Task API — this is Avoca's
 * buyer map. For each monitored metro: which PE-backed roll-ups, platform
 * brands, and franchise networks run residential HVAC/plumbing/electrical
 * there. Turns the weather map into a territory map — click a metro, see the
 * demand signal AND who's there to sell it to.
 *
 * Usage:
 *   npx tsx scripts/market-intel.ts submit    # kick off one pro run per metro
 *   npx tsx scripts/market-intel.ts collect   # poll + save completed results
 */

import * as fs from "fs";
import * as path from "path";
import { METROS } from "./metros";

const API_KEY = process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";
const DATA = path.join(__dirname, "..", "data");
const RUNS_PATH = path.join(DATA, "market-intel-runs.json");
const OUT_PATH = path.join(DATA, "market-intel.json");

const MARKET_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      market_snapshot: {
        type: "string" as const,
        description:
          "2-3 sentences on this metro's residential-trades market: size/growth signals, consolidation level, and what drives service demand there.",
      },
      buyers: {
        type: "array" as const,
        description:
          "The 4-6 most significant residential HVAC/plumbing/electrical operators in this metro that a call-center AI vendor would target, prioritizing PE-backed roll-ups and multi-brand platforms, then franchise networks, then large independents.",
        items: {
          type: "object" as const,
          properties: {
            company: {
              type: "string" as const,
              description: "Local operating brand name",
            },
            type: {
              type: "string" as const,
              enum: ["pe_rollup_brand", "franchise", "large_independent"],
              description: "Buyer shape",
            },
            parent: {
              type: "string" as const,
              description:
                "Parent platform / PE sponsor / franchisor (e.g. 'Apex Service Partners (Alpine Investors)'), or 'independent'",
            },
            trades: {
              type: "string" as const,
              description: "Trades covered, e.g. 'HVAC, plumbing, electrical'",
            },
            note: {
              type: "string" as const,
              description:
                "One line on why they matter: scale, recent acquisition, market position",
            },
          },
          required: ["company", "type", "parent", "trades", "note"],
          additionalProperties: false,
        },
      },
      rollup_activity: {
        type: "string" as const,
        description:
          "1-2 sentences on recent consolidation/M&A activity in this metro's residential trades (acquisitions, new platform entries), with names and approximate dates where known.",
      },
    },
    required: ["market_snapshot", "buyers", "rollup_activity"],
    additionalProperties: false,
  },
};

function buildInput(m: (typeof METROS)[number]): string {
  return (
    `Research the residential trades (HVAC, plumbing, electrical home services) market in the ` +
    `${m.name} metro area (${m.counties}). Identify the most significant operators a company selling ` +
    `AI call-center/CSR software to home-services contractors would target: private-equity-backed ` +
    `roll-up brands and their parent platforms (e.g. Apex Service Partners, Wrench Group, Turnpoint ` +
    `Services, Leap Partners, Sila Services, Horizon Services and similar), national franchise networks ` +
    `with strong local presence (e.g. Neighborly brands, Authority Brands, ARS/Rescue Rooter), and the ` +
    `largest independent shops. Verify parent/sponsor relationships as of 2025-2026 — ownership changes fast.`
  );
}

async function submit() {
  const existing: Record<string, any> = fs.existsSync(RUNS_PATH)
    ? JSON.parse(fs.readFileSync(RUNS_PATH, "utf-8"))
    : {};
  for (const m of METROS) {
    if (existing[m.id]) {
      console.log(`  - ${m.id} already submitted (${existing[m.id].runId})`);
      continue;
    }
    const res = await fetch(`${BASE_URL}/v1/tasks/runs`, {
      method: "POST",
      headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: buildInput(m),
        task_spec: { output_schema: MARKET_SCHEMA },
        processor: "pro",
        metadata: { demo: "avoca-weather", kind: "market-intel", metro: m.id },
      }),
    });
    if (!res.ok) {
      console.error(`  ✗ ${m.id}: ${res.status} ${await res.text()}`);
      continue;
    }
    const data = await res.json();
    existing[m.id] = { runId: data.run_id, submittedAt: new Date().toISOString() };
    fs.writeFileSync(RUNS_PATH, JSON.stringify(existing, null, 2));
    console.log(`  ✓ ${m.id.padEnd(12)} → ${data.run_id}`);
  }
}

async function collect() {
  const runs = JSON.parse(fs.readFileSync(RUNS_PATH, "utf-8"));
  const out: Record<string, any> = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"))
    : {};
  let done = 0, pending = 0;
  for (const [metroId, info] of Object.entries(runs) as [string, any][]) {
    if (out[metroId]) { done++; continue; }
    const res = await fetch(`${BASE_URL}/v1/tasks/runs/${info.runId}/result`, {
      headers: { "x-api-key": API_KEY! },
    });
    if (!res.ok) {
      const statusRes = await fetch(`${BASE_URL}/v1/tasks/runs/${info.runId}`, {
        headers: { "x-api-key": API_KEY! },
      });
      const status = statusRes.ok ? (await statusRes.json()).status : `${res.status}`;
      console.log(`  … ${metroId.padEnd(12)} ${status}`);
      pending++;
      continue;
    }
    const data = await res.json();
    out[metroId] = {
      content: data.output?.content,
      collectedAt: new Date().toISOString(),
      runId: info.runId,
    };
    fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
    console.log(`  ✓ ${metroId.padEnd(12)} collected (${(data.output?.content?.buyers || []).length} buyers)`);
    done++;
  }
  console.log(`\n${done} collected, ${pending} still running → ${OUT_PATH}`);
}

const cmd = process.argv[2];
if (cmd === "submit") submit().catch(console.error);
else if (cmd === "collect") collect().catch(console.error);
else console.error("usage: market-intel.ts submit|collect");
