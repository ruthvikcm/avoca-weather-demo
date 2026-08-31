/**
 * Generates map.html — the self-contained map UI — from live pipeline data.
 *
 * Reads data/monitors.json, data/events.jsonl, data/nws-alerts.jsonl,
 * data/scorecard.json plus the pre-projected us-atlas topology, renders
 * SVG path data + a JSON payload into map-template.html, writes map.html.
 *
 * Re-run after each poll cycle you want reflected, then republish:
 *   npx tsx scripts/score.ts --json data/scorecard.json
 *   npx tsx scripts/build-map.ts
 *
 * --live additionally writes the Vercel deployment into deploy/:
 *   deploy/index.html          same UI, but DATA=null → fetches /api/data
 *   deploy/api/_static.json    metros/market/briefs/scorecard/monitor ids
 * (events + NWS alerts are fetched live by deploy/api/data.ts at request time)
 */

import * as fs from "fs";
import * as path from "path";
import { geoAlbersUsa, geoPath } from "d3-geo";
import * as topojson from "topojson-client";
import { METROS } from "./metros";
import { COST_PER_EXEC } from "./monitor-configs";

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");

function readJsonl(p: string): any[] {
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// Metro centroids (lon, lat) for marker placement
const METRO_COORDS: Record<string, [number, number]> = {
  dfw: [-97.04, 32.9],
  houston: [-95.3698, 29.7604],
  phoenix: [-112.074, 33.4484],
  atlanta: [-84.388, 33.749],
  chicago: [-87.6298, 41.8781],
  msp: [-93.265, 44.9778],
  denver: [-104.9903, 39.7392],
  tampa: [-82.4572, 27.9506],
  philly: [-75.1652, 39.9526],
  nashville: [-86.7816, 36.1627],
  kc: [-94.5786, 39.0997],
  stl: [-90.1994, 38.627],
  detroit: [-83.0458, 42.3314],
  boston: [-71.0589, 42.3601],
  charlotte: [-80.8431, 35.2271],
  sanantonio: [-98.4936, 29.4241],
  okc: [-97.5164, 35.4676],
  slc: [-111.891, 40.7608],
  miami: [-80.1918, 25.7617],
  seattle: [-122.3321, 47.6062],
  tucson: [-110.9747, 32.2226],
  abq: [-106.6504, 35.0844],
  omaha: [-95.9345, 41.2565],
  desmoines: [-93.6091, 41.5868],
  louisville: [-85.7585, 38.2527],
  richmond: [-77.436, 37.5407],
  greenville: [-82.394, 34.8526],
  tulsa: [-95.9928, 36.154],
  cosprings: [-104.8214, 38.8339],
  boise: [-116.2023, 43.615],
};

function main() {
  // --- Map geometry (us-atlas states-albers-10m is pre-projected to 975x610
  // with geoAlbersUsa().scale(1300).translate([487.5, 305])) ---
  const us = JSON.parse(
    fs.readFileSync(path.join(DATA, "states-albers-10m.json"), "utf-8")
  );
  const pathGen = geoPath();
  const nationPath = pathGen(
    topojson.feature(us, us.objects.nation) as any
  ) as string;
  const meshPath = pathGen(
    topojson.mesh(us, us.objects.states, (a: any, b: any) => a !== b)
  ) as string;
  const proj = geoAlbersUsa().scale(1300).translate([487.5, 305]);

  // --- Pipeline data ---
  const monitors = JSON.parse(
    fs.readFileSync(path.join(DATA, "monitors.json"), "utf-8")
  );
  const rawEvents = readJsonl(path.join(DATA, "events.jsonl"));
  const rawAlerts = readJsonl(path.join(DATA, "nws-alerts.jsonl"));
  const scorecard = fs.existsSync(path.join(DATA, "scorecard.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA, "scorecard.json"), "utf-8"))
    : null;
  const marketIntel = fs.existsSync(path.join(DATA, "market-intel.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA, "market-intel.json"), "utf-8"))
    : {};
  const surgeBriefs = fs.existsSync(path.join(DATA, "surge-briefs.json"))
    ? JSON.parse(fs.readFileSync(path.join(DATA, "surge-briefs.json"), "utf-8"))
    : {};

  const events = rawEvents.map((e) => {
    const c = e.raw?.output?.content ?? {};
    return {
      id: e.eventId,
      metro: e.metroId,
      config: e.config,
      type: c.event_type ?? e.narrowEventType ?? "other",
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
        .filter((u) => u.startsWith("http")),
      firstSeen: e.firstSeenAt,
    };
  });

  const seenAlert = new Set<string>();
  const now = Date.now();
  const alerts = rawAlerts
    .filter((a) => (seenAlert.has(a.id) ? false : (seenAlert.add(a.id), true)))
    .map((a) => ({
      id: a.id,
      metros: a.metros,
      event: a.event,
      category: a.category,
      severity: a.severity,
      sent: a.sent,
      ends: a.ends || a.expires || null,
      headline: a.headline || a.event,
      areaDesc: a.areaDesc,
      active: new Date(a.ends || a.expires || 0).getTime() > now,
    }));

  const metros = METROS.map((m) => {
    const [x, y] = proj(METRO_COORDS[m.id])!;
    return {
      id: m.id,
      name: m.name,
      x: +x.toFixed(1),
      y: +y.toFixed(1),
      lonlat: METRO_COORDS[m.id],
      coverage: m.narrowEventTypes,
      counties: m.counties,
      note: m.tradesNote,
    };
  });

  const nNarrow = Object.values(monitors).filter(
    (m: any) => m.config === "narrow"
  ).length;
  const nWide = Object.values(monitors).filter(
    (m: any) => m.config === "wide"
  ).length;

  const payload = {
    generatedAt: new Date().toISOString(),
    fleet: {
      narrow: nNarrow,
      wide: nWide,
      narrowMonthly: +(nNarrow * 24 * 30 * COST_PER_EXEC.lite).toFixed(0),
      wideMonthly: +(nWide * 24 * 30 * COST_PER_EXEC.base).toFixed(0),
      dailyTotal: +(
        nNarrow * 24 * COST_PER_EXEC.lite +
        nWide * 24 * COST_PER_EXEC.base
      ).toFixed(2),
    },
    scorecard: scorecard?.configs ?? null,
    metros,
    events,
    alerts,
    market: Object.fromEntries(
      Object.entries(marketIntel).map(([k, v]: [string, any]) => [k, v.content])
    ),
    briefs: Object.fromEntries(
      Object.entries(surgeBriefs).map(([k, v]: [string, any]) => [
        k,
        { ...v.content, generatedAt: v.generatedAt },
      ])
    ),
  };

  const template = fs.readFileSync(
    path.join(ROOT, "map-template.html"),
    "utf-8"
  );
  const html = template
    .split("__NATION_PATH__").join(nationPath)
    .split("__MESH_PATH__").join(meshPath)
    .split("__DATA__").join(JSON.stringify(payload).replace(/<\//g, "<\\/"));

  const outPath = path.join(ROOT, "map.html");
  fs.writeFileSync(outPath, html);
  console.log(
    `map.html written (${(html.length / 1024).toFixed(0)} KB): ` +
      `${metros.length} metros, ${events.length} events, ${alerts.length} alerts ` +
      `(${alerts.filter((a) => a.active).length} active)`
  );

  if (process.argv.includes("--live")) {
    const deployDir = path.join(ROOT, "deploy");
    fs.mkdirSync(path.join(deployDir, "api"), { recursive: true });

    const liveHtml = template
      .split("__NATION_PATH__").join(nationPath)
      .split("__MESH_PATH__").join(meshPath)
      .split("__DATA__").join("null");
    fs.writeFileSync(path.join(deployDir, "index.html"), liveHtml);

    const staticPayload = {
      fleet: payload.fleet,
      scorecard: payload.scorecard,
      scorecardAsOf: scorecard?.generatedAt ?? null,
      metros: METROS.map((m) => {
        const [x, y] = proj(METRO_COORDS[m.id])!;
        return {
          id: m.id,
          name: m.name,
          x: +x.toFixed(1),
          y: +y.toFixed(1),
          lonlat: METRO_COORDS[m.id],
          coverage: m.narrowEventTypes,
          counties: m.counties,
          note: m.tradesNote,
          sameCodes: m.sameCodes,
          nwsArea: m.nwsArea,
        };
      }),
      market: payload.market,
      briefs: payload.briefs,
      monitors: Object.entries(monitors).map(([defId, v]: [string, any]) => ({
        defId,
        monitorId: v.monitorId,
        config: v.config,
        metroId: v.metroId,
        eventType: v.eventType ?? null,
      })),
    };
    fs.writeFileSync(
      path.join(deployDir, "api", "_static.json"),
      JSON.stringify(staticPayload)
    );
    console.log(
      `deploy/ written: index.html (live mode) + api/_static.json (${staticPayload.monitors.length} monitors)`
    );
  }
}

main();
