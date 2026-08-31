/**
 * Creates the narrow + wide monitor fleets via the Parallel Monitor API.
 * Saves monitor ids + config tags to data/monitors.json for polling/scoring.
 *
 * Usage: PARALLEL_API_KEY=... npx tsx scripts/setup-monitors.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import { MONITOR_DEFS, MONITOR_OUTPUT_SCHEMA, COST_PER_EXEC } from "./monitor-configs";

const API_KEY = process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";
const OUT_PATH = path.join(__dirname, "..", "data", "monitors.json");

async function createMonitor(def: (typeof MONITOR_DEFS)[number]) {
  const body = {
    type: "event_stream",
    frequency: def.frequency,
    settings: {
      query: def.query,
      processor: def.processor,
      output_schema: MONITOR_OUTPUT_SCHEMA,
    },
    metadata: {
      demo: "avoca-weather",
      demo_id: def.id,
      config: def.config,
      metro: def.metroId,
      ...(def.eventType ? { event_type: def.eventType } : {}),
    },
  };

  const res = await fetch(`${BASE_URL}/v1/monitors`, {
    method: "POST",
    headers: { "x-api-key": API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${def.id}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const narrow = MONITOR_DEFS.filter((d) => d.config === "narrow");
  const wide = MONITOR_DEFS.filter((d) => d.config === "wide");

  const dailyNarrow = narrow.length * 24 * COST_PER_EXEC.lite;
  const dailyWide = wide.length * 24 * COST_PER_EXEC.base;
  console.log(
    `Fleet: ${narrow.length} narrow (lite, $${dailyNarrow.toFixed(2)}/day) + ` +
      `${wide.length} wide (base, $${dailyWide.toFixed(2)}/day) = ` +
      `$${(dailyNarrow + dailyWide).toFixed(2)}/day total\n`
  );

  if (dryRun) {
    for (const d of MONITOR_DEFS) console.log(`  [dry] ${d.id} (${d.processor})`);
    return;
  }
  if (!API_KEY) throw new Error("PARALLEL_API_KEY not set");

  const results: Record<string, unknown> = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"))
    : {};

  for (const def of MONITOR_DEFS) {
    if (results[def.id]) {
      console.log(`  - ${def.id.padEnd(26)} already exists, skipping`);
      continue;
    }
    try {
      const result = await createMonitor(def);
      results[def.id] = {
        monitorId: result.monitor_id,
        config: def.config,
        metroId: def.metroId,
        metroName: def.metroName,
        eventType: def.eventType,
        processor: def.processor,
        frequency: def.frequency,
        query: def.query,
        createdAt: new Date().toISOString(),
      };
      fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
      console.log(`  ✓ ${def.id.padEnd(26)} → ${result.monitor_id}`);
    } catch (e) {
      console.error(`  ✗ ${(e as Error).message}`);
    }
  }

  console.log(`\n${Object.keys(results).length} monitors saved to ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
