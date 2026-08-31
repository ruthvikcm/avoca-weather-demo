/**
 * Monitor definitions for the Avoca weather-demand demo.
 *
 * Two competing configs over the same 10 metros — the experiment is the
 * query design, everything else held constant (hourly, same output schema):
 *
 *  - NARROW ("lite", $0.003/exec): one targeted monitor per metro per
 *    relevant event class (freeze / heat / storm / flood). 37 monitors
 *    total — the per-metro event list in metros.ts is what multiplies cost.
 *  - WIDE ("base", $0.01/exec): one broad demand-framed monitor per metro
 *    covering weather + utility outages + emergency declarations. 10 total.
 *
 * `first_detected_at` is deliberately NOT in the output schema: detection
 * time is measured on our side (first time an event_id appears in a poll,
 * plus the event's own server timestamps) and compared against the NWS
 * alert `sent` time from ground truth. Asking the model to self-report
 * detection latency would be circular.
 */

import { METROS, Metro, NarrowEventType } from "./metros";

export interface MonitorDef {
  id: string;
  config: "narrow" | "wide";
  metroId: string;
  metroName: string;
  eventType?: NarrowEventType; // narrow only
  query: string;
  frequency: string;
  processor: "lite" | "base";
}

/**
 * Shared structured-output schema — every detected event, both configs.
 */
export const MONITOR_OUTPUT_SCHEMA = {
  type: "json" as const,
  json_schema: {
    type: "object" as const,
    properties: {
      event_type: {
        type: "string" as const,
        description: "Primary class of the demand-relevant event",
        enum: [
          "freeze",
          "heat_wave",
          "severe_storm",
          "tropical_system",
          "flood",
          "power_outage",
          "emergency_declaration",
          "other",
        ],
      },
      severity: {
        type: "string" as const,
        description:
          "Official alert level if NWS-issued, otherwise closest equivalent",
        enum: ["advisory", "watch", "warning", "emergency"],
      },
      headline: {
        type: "string" as const,
        description: "One-line headline for the event (under 120 characters)",
      },
      geography: {
        type: "string" as const,
        description:
          "Metro plus specific affected sub-areas (counties, cities, zones) if named by the source",
      },
      onset: {
        type: "string" as const,
        description:
          "When the event begins or began (ISO 8601 if the source gives a time, otherwise as stated)",
      },
      expected_duration: {
        type: "string" as const,
        description:
          "Expected duration or end time of the event as stated by the source",
      },
      demand_signal: {
        type: "string" as const,
        description:
          "Which residential trades this hits and why — e.g. 'plumbing: hard freeze, burst-pipe calls expected within 24-48h of thaw', 'HVAC: excessive heat, AC failure surge', 'electrical: sustained outages, generator/panel calls'",
      },
      published_at: {
        type: "string" as const,
        description:
          "Timestamp the source says the alert/report was issued (e.g. NWS 'sent' time), ISO 8601 if available",
      },
      nws_reference: {
        type: "string" as const,
        description:
          "Official NWS product name if this is an NWS alert (e.g. 'Excessive Heat Warning'), or 'none' if not NWS-sourced",
      },
      source_urls: {
        type: "string" as const,
        description:
          "Comma-separated URLs of the primary sources (NWS, local news, utility outage pages)",
      },
    },
    required: [
      "event_type",
      "severity",
      "headline",
      "geography",
      "onset",
      "expected_duration",
      "demand_signal",
      "published_at",
      "nws_reference",
      "source_urls",
    ],
    additionalProperties: false,
  },
};

/**
 * NARROW queries — deliberately targeted, one event class each. This is the
 * "cheap but you need N of them" arm of the test.
 */
const NARROW_QUERIES: Record<NarrowEventType, (m: Metro) => string> = {
  freeze: (m) =>
    `Active National Weather Service freeze warnings, hard freeze warnings, extreme cold warnings, wind chill warnings, or winter storm warnings/watches for the ${m.name} metro area (${m.counties}).`,
  heat: (m) =>
    `Active National Weather Service extreme heat warnings, excessive heat warnings, heat advisories, or extreme heat watches for the ${m.name} metro area (${m.counties}).`,
  storm: (m) =>
    `Active National Weather Service severe thunderstorm, tornado, high wind, hail, hurricane, or tropical storm warnings/watches for the ${m.name} metro area (${m.counties}).`,
  flood: (m) =>
    `Active National Weather Service flood warnings, flash flood warnings/watches, or coastal flood warnings for the ${m.name} metro area (${m.counties}).`,
};

/**
 * WIDE query — one per metro, demand-framed, covers everything including
 * non-NWS signals (utility outages, emergency declarations) the narrow
 * monitors structurally can't see. That asymmetry is part of the test.
 */
function wideQuery(m: Metro): string {
  return (
    `Weather events, utility power outages, or emergency declarations in the ${m.name} metro area (${m.counties}) ` +
    `likely to drive residential HVAC, plumbing, or electrical service demand in the next 72 hours. ` +
    `Include: NWS watches, warnings, and advisories (extreme cold/freeze, extreme heat, severe storms, tornadoes, ` +
    `hail, high wind, flooding, tropical systems); major utility outage events or planned shutoffs; boil-water ` +
    `notices; and state or local emergency declarations.`
  );
}

export const MONITOR_DEFS: MonitorDef[] = [
  // NARROW fleet — lite processor, one monitor per metro per event class
  ...METROS.flatMap((m) =>
    m.narrowEventTypes.map(
      (et): MonitorDef => ({
        id: `narrow-${m.id}-${et}`,
        config: "narrow",
        metroId: m.id,
        metroName: m.name,
        eventType: et,
        query: NARROW_QUERIES[et](m),
        frequency: "1h",
        processor: "lite",
      })
    )
  ),
  // WIDE fleet — base processor, one monitor per metro
  ...METROS.map(
    (m): MonitorDef => ({
      id: `wide-${m.id}`,
      config: "wide",
      metroId: m.id,
      metroName: m.name,
      query: wideQuery(m),
      frequency: "1h",
      processor: "base",
    })
  ),
];

// Cost model constants (per-execution, hourly cadence)
export const COST_PER_EXEC = { lite: 0.003, base: 0.01 } as const;
