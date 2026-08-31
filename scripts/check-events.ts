/**
 * Polls all monitors for events. Appends new events to data/events.jsonl and
 * records the first time each event_id was seen in data/first-seen.json —
 * that local timestamp (plus any server-side timestamps on the event) is the
 * detection side of the latency measurement vs. NWS `sent`.
 *
 * Run on a cadence tighter than the monitors' hourly execution (e.g. every
 * 15 min via cron) so first-seen is a tight upper bound on detection time.
 *
 * Usage: PARALLEL_API_KEY=... npx tsx scripts/check-events.ts [--verbose]
 */

import * as fs from "fs";
import * as path from "path";

const API_KEY = process.env.PARALLEL_API_KEY;
const BASE_URL = "https://api.parallel.ai";
const DATA = path.join(__dirname, "..", "data");
const MONITORS_PATH = path.join(DATA, "monitors.json");
const EVENTS_PATH = path.join(DATA, "events.jsonl");
const FIRST_SEEN_PATH = path.join(DATA, "first-seen.json");

async function main() {
  const verbose = process.argv.includes("--verbose");
  if (!API_KEY) throw new Error("PARALLEL_API_KEY not set");
  const monitors = JSON.parse(fs.readFileSync(MONITORS_PATH, "utf-8"));

  const firstSeen: Record<string, string> = fs.existsSync(FIRST_SEEN_PATH)
    ? JSON.parse(fs.readFileSync(FIRST_SEEN_PATH, "utf-8"))
    : {};

  const now = new Date().toISOString();
  let newEvents = 0;
  let errors = 0;
  const out = fs.createWriteStream(EVENTS_PATH, { flags: "a" });

  for (const [defId, info] of Object.entries(monitors) as [string, any][]) {
    let events: any[] = [];
    try {
      const res = await fetch(`${BASE_URL}/v1/monitors/${info.monitorId}/events`, {
        headers: { "x-api-key": API_KEY },
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
      events = (await res.json()).events || [];
    } catch (e) {
      errors++;
      if (verbose) console.error(`  ✗ ${defId}: ${(e as Error).message}`);
      continue;
    }

    for (const evt of events) {
      const id = evt.event_id || evt.id;
      if (!id || firstSeen[id]) continue;
      firstSeen[id] = now;
      newEvents++;
      out.write(
        JSON.stringify({
          eventId: id,
          defId,
          monitorId: info.monitorId,
          config: info.config,
          metroId: info.metroId,
          narrowEventType: info.eventType,
          firstSeenAt: now,
          raw: evt,
        }) + "\n"
      );
      if (verbose) {
        const c = evt.output?.content;
        const head = typeof c === "object" ? c?.headline : String(c || "").slice(0, 80);
        console.log(`  + [${info.config}] ${defId}: ${head}`);
      }
    }
  }
  out.end();
  fs.writeFileSync(FIRST_SEEN_PATH, JSON.stringify(firstSeen, null, 2));
  console.log(
    `${now} polled ${Object.keys(monitors).length} monitors: ${newEvents} new events, ${errors} errors, ${Object.keys(firstSeen).length} total tracked`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
