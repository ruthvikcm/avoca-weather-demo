/**
 * The 10 target metros for the Avoca weather-demand monitor.
 *
 * Selection logic: large residential-trades markets (heavy PE roll-up /
 * franchise presence) crossed with distinct weather-risk profiles so the
 * narrow-vs-wide query test sees every event class: hard freeze (DFW, MSP,
 * Chicago), extreme heat (Phoenix, DFW), severe storm / hail / tornado
 * (Denver, Nashville, Chicago), tropical + flood (Tampa, Houston), and
 * winter mix (Philadelphia, Atlanta ice).
 *
 * `narrowEventTypes` is per-metro on purpose: narrow monitors only get
 * created for event classes that actually occur there (no freeze monitor
 * for Phoenix, no hurricane monitor for Denver). The real monitor count —
 * not metros × 4 — is what goes into the cost model.
 *
 * `sameCodes` are the NWS SAME/FIPS geocodes for the metro's core counties,
 * used to filter api.weather.gov alerts into per-metro ground truth.
 */

export type NarrowEventType = "freeze" | "heat" | "storm" | "flood";

export interface Metro {
  id: string; // slug used in monitor ids
  name: string; // display name
  cbsa: string; // CBSA code
  states: string[];
  nwsArea: string[]; // state codes for api.weather.gov ?area=
  sameCodes: string[]; // 6-digit SAME codes of core counties
  counties: string; // human-readable core counties (used in queries)
  narrowEventTypes: NarrowEventType[];
  tradesNote: string; // why this metro matters to Avoca's buyers
}

export const METROS: Metro[] = [
  {
    id: "dfw",
    name: "Dallas–Fort Worth, TX",
    cbsa: "19100",
    states: ["TX"],
    nwsArea: ["TX"],
    sameCodes: ["048113", "048439", "048085", "048121"],
    counties: "Dallas, Tarrant, Collin, and Denton counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Uri 2021 pipe-burst epicenter; huge HVAC+plumbing market, dense PE roll-up presence",
  },
  {
    id: "houston",
    name: "Houston, TX",
    cbsa: "26420",
    states: ["TX"],
    nwsArea: ["TX"],
    sameCodes: ["048201", "048157", "048339", "048167"],
    counties: "Harris, Fort Bend, Montgomery, and Galveston counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Hurricane + flood + freeze exposure in one market; year-round AC dependence",
  },
  {
    id: "phoenix",
    name: "Phoenix, AZ",
    cbsa: "38060",
    states: ["AZ"],
    nwsArea: ["AZ"],
    sameCodes: ["004013", "004021"],
    counties: "Maricopa and Pinal counties",
    narrowEventTypes: ["heat", "storm", "flood"],
    tradesNote:
      "Extreme-heat capital — AC failure is a safety emergency; monsoon wind/flood; no freeze monitor (honest coverage gap in narrow config)",
  },
  {
    id: "atlanta",
    name: "Atlanta, GA",
    cbsa: "12060",
    states: ["GA"],
    nwsArea: ["GA"],
    sameCodes: ["013121", "013089", "013067", "013135"],
    counties: "Fulton, DeKalb, Cobb, and Gwinnett counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Ice storms paralyze a market not built for them; major roll-up hub in the Southeast",
  },
  {
    id: "chicago",
    name: "Chicago, IL",
    cbsa: "16980",
    states: ["IL"],
    nwsArea: ["IL"],
    sameCodes: ["017031", "017043", "017097", "017197"],
    counties: "Cook, DuPage, Lake, and Will counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Classic four-season demand spikes: polar vortex freezes, summer heat waves, derechos",
  },
  {
    id: "msp",
    name: "Minneapolis–St. Paul, MN",
    cbsa: "33460",
    states: ["MN"],
    nwsArea: ["MN"],
    sameCodes: ["027053", "027123", "027037", "027003"],
    counties: "Hennepin, Ramsey, Dakota, and Anoka counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Hard-freeze market where furnace failure is life-safety; strong franchise networks",
  },
  {
    id: "denver",
    name: "Denver, CO",
    cbsa: "19740",
    states: ["CO"],
    nwsArea: ["CO"],
    sameCodes: ["008031", "008005", "008059", "008001"],
    counties: "Denver, Arapahoe, Jefferson, and Adams counties",
    narrowEventTypes: ["freeze", "heat", "storm"],
    tradesNote:
      "Hail alley — storm damage drives electrical/roofing-adjacent calls; fast freeze swings",
  },
  {
    id: "tampa",
    name: "Tampa–St. Petersburg, FL",
    cbsa: "45300",
    states: ["FL"],
    nwsArea: ["FL"],
    sameCodes: ["012057", "012103", "012101"],
    counties: "Hillsborough, Pinellas, and Pasco counties",
    narrowEventTypes: ["heat", "storm", "flood"],
    tradesNote:
      "Tropical systems + lightning capital of the US; AC is non-negotiable; storm restoration surges",
  },
  {
    id: "philly",
    name: "Philadelphia, PA",
    cbsa: "37980",
    states: ["PA", "NJ"],
    nwsArea: ["PA", "NJ"],
    sameCodes: ["042101", "042091", "042017", "042045", "034007"],
    counties:
      "Philadelphia, Montgomery, Bucks, and Delaware counties (PA) plus Camden County (NJ)",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Nor'easter + aging-housing-stock market; old pipes and old furnaces fail on cue",
  },
  {
    id: "nashville",
    name: "Nashville, TN",
    cbsa: "34980",
    states: ["TN"],
    nwsArea: ["TN"],
    sameCodes: ["047037", "047149", "047187", "047189"],
    counties: "Davidson, Rutherford, Williamson, and Wilson counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Tornado alley east; ice storms; one of the fastest-growing trades markets in the country",
  },

  // --- Expansion wave 2 (added 2026-08-06) ---
  {
    id: "kc",
    name: "Kansas City, MO",
    cbsa: "28140",
    states: ["MO", "KS"],
    nwsArea: ["MO", "KS"],
    sameCodes: ["029095", "029047", "029165", "020091", "020209"],
    counties: "Jackson, Clay, and Platte counties (MO) plus Johnson and Wyandotte counties (KS)",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Full four-hazard market: ice storms, heat domes, hail, flash flood — a classic surge-whipsaw metro",
  },
  {
    id: "stl",
    name: "St. Louis, MO",
    cbsa: "41180",
    states: ["MO", "IL"],
    nwsArea: ["MO", "IL"],
    sameCodes: ["029510", "029189", "029183", "017119", "017163"],
    counties: "St. Louis City, St. Louis, and St. Charles counties (MO) plus Madison and St. Clair counties (IL)",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Aging housing stock + severe convective corridor; strong independent-contractor consolidation target",
  },
  {
    id: "detroit",
    name: "Detroit, MI",
    cbsa: "19820",
    states: ["MI"],
    nwsArea: ["MI"],
    sameCodes: ["026163", "026125", "026099"],
    counties: "Wayne, Oakland, and Macomb counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Hard-freeze market with basement-flooding epidemics after summer downpours; big franchise presence",
  },
  {
    id: "boston",
    name: "Boston, MA",
    cbsa: "14460",
    states: ["MA"],
    nwsArea: ["MA"],
    sameCodes: ["025025", "025017", "025021", "025009"],
    counties: "Suffolk, Middlesex, Norfolk, and Essex counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Nor'easter capital; oil-to-heat-pump conversion wave makes HVAC demand structurally rising",
  },
  {
    id: "charlotte",
    name: "Charlotte, NC",
    cbsa: "16740",
    states: ["NC", "SC"],
    nwsArea: ["NC", "SC"],
    sameCodes: ["037119", "037179", "037071", "037025", "045091"],
    counties: "Mecklenburg, Union, Gaston, and Cabarrus counties (NC) plus York County (SC)",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Sunbelt growth market: ice storms, hurricane remnants, PE roll-up hotbed in the Carolinas",
  },
  {
    id: "sanantonio",
    name: "San Antonio, TX",
    cbsa: "41700",
    states: ["TX"],
    nwsArea: ["TX"],
    sameCodes: ["048029", "048091", "048187"],
    counties: "Bexar, Comal, and Guadalupe counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Uri-class freeze exposure + flash-flood alley; fast-growing metro with year-round AC dependence",
  },
  {
    id: "okc",
    name: "Oklahoma City, OK",
    cbsa: "36420",
    states: ["OK"],
    nwsArea: ["OK"],
    sameCodes: ["040109", "040027", "040017"],
    counties: "Oklahoma, Cleveland, and Canadian counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Hail and tornado capital of the US; ice storms; storm-driven demand spikes are the norm, not the exception",
  },
  {
    id: "slc",
    name: "Salt Lake City, UT",
    cbsa: "41620",
    states: ["UT"],
    nwsArea: ["UT"],
    sameCodes: ["049035", "049011", "049049", "049057"],
    counties: "Salt Lake, Davis, Utah, and Weber counties",
    narrowEventTypes: ["freeze", "heat", "storm"],
    tradesNote:
      "High-desert freeze/heat swings and canyon windstorms; flood risk minor — no flood monitor (honest gap)",
  },
  {
    id: "miami",
    name: "Miami, FL",
    cbsa: "33100",
    states: ["FL"],
    nwsArea: ["FL"],
    sameCodes: ["012086", "012011", "012099"],
    counties: "Miami-Dade, Broward, and Palm Beach counties",
    narrowEventTypes: ["heat", "storm", "flood"],
    tradesNote:
      "Hurricane ground zero; king-tide and rain flooding; AC is life support — no freeze monitor",
  },
  {
    id: "seattle",
    name: "Seattle, WA",
    cbsa: "42660",
    states: ["WA"],
    nwsArea: ["WA"],
    sameCodes: ["053033", "053061", "053053"],
    counties: "King, Snohomish, and Pierce counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Housing stock built for neither freezes nor heat — 2021 heat dome and cold snaps both melt call boards",
  },

  // --- Expansion wave 3: smaller mid-market metros (added 2026-08-06) ---
  {
    id: "tucson",
    name: "Tucson, AZ",
    cbsa: "46060",
    states: ["AZ"],
    nwsArea: ["AZ"],
    sameCodes: ["004019"],
    counties: "Pima County",
    narrowEventTypes: ["heat", "storm", "flood"],
    tradesNote:
      "Extreme heat + monsoon market at a size where a single shop's booked-call rate is the whole game",
  },
  {
    id: "abq",
    name: "Albuquerque, NM",
    cbsa: "10740",
    states: ["NM"],
    nwsArea: ["NM"],
    sameCodes: ["035001", "035043", "035061"],
    counties: "Bernalillo, Sandoval, and Valencia counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "High-desert swing market: hard freezes and monsoon floods in the same year; light consolidation so far",
  },
  {
    id: "omaha",
    name: "Omaha, NE",
    cbsa: "36540",
    states: ["NE", "IA"],
    nwsArea: ["NE", "IA"],
    sameCodes: ["031055", "031153", "019155"],
    counties: "Douglas and Sarpy counties (NE) plus Pottawattamie County (IA)",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Full four-hazard plains market — ice, heat domes, derechos, hail — with tight CSR labor supply",
  },
  {
    id: "desmoines",
    name: "Des Moines, IA",
    cbsa: "19780",
    states: ["IA"],
    nwsArea: ["IA"],
    sameCodes: ["019153", "019049", "019181"],
    counties: "Polk, Dallas, and Warren counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Classic small-metro test: one derecho or ice storm saturates every shop in town simultaneously",
  },
  {
    id: "louisville",
    name: "Louisville, KY",
    cbsa: "31140",
    states: ["KY", "IN"],
    nwsArea: ["KY", "IN"],
    sameCodes: ["021111", "021185", "021029", "018019", "018043"],
    counties: "Jefferson, Oldham, and Bullitt counties (KY) plus Clark and Floyd counties (IN)",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Ohio Valley ice/flood corridor; aging housing stock; active roll-up acquisition territory",
  },
  {
    id: "richmond",
    name: "Richmond, VA",
    cbsa: "40060",
    states: ["VA"],
    nwsArea: ["VA"],
    sameCodes: ["051760", "051087", "051041", "051085"],
    counties: "Richmond City plus Henrico, Chesterfield, and Hanover counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Mid-Atlantic mix of ice, heat, and hurricane remnants; strong franchise-network presence",
  },
  {
    id: "greenville",
    name: "Greenville, SC",
    cbsa: "24860",
    states: ["SC"],
    nwsArea: ["SC"],
    sameCodes: ["045045", "045083", "045077", "045007"],
    counties: "Greenville, Spartanburg, Pickens, and Anderson counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Upstate SC growth market; ice storms on unprepared infrastructure; PE roll-ups expanding from Charlotte",
  },
  {
    id: "tulsa",
    name: "Tulsa, OK",
    cbsa: "46140",
    states: ["OK"],
    nwsArea: ["OK"],
    sameCodes: ["040143", "040131", "040145", "040113"],
    counties: "Tulsa, Rogers, Wagoner, and Osage counties",
    narrowEventTypes: ["freeze", "heat", "storm", "flood"],
    tradesNote:
      "Hail/tornado + ice-storm market; 2007 ice storm remains the industry's benchmark surge story",
  },
  {
    id: "cosprings",
    name: "Colorado Springs, CO",
    cbsa: "17820",
    states: ["CO"],
    nwsArea: ["CO"],
    sameCodes: ["008041", "008119"],
    counties: "El Paso and Teller counties",
    narrowEventTypes: ["freeze", "heat", "storm"],
    tradesNote:
      "Front Range hail + fast freeze swings; smaller shadow market to Denver's roll-ups",
  },
  {
    id: "boise",
    name: "Boise, ID",
    cbsa: "14260",
    states: ["ID"],
    nwsArea: ["ID"],
    sameCodes: ["016001", "016027"],
    counties: "Ada and Canyon counties",
    narrowEventTypes: ["freeze", "heat", "storm"],
    tradesNote:
      "Fast-growing small metro; hard winters + smoke-season heat; almost entirely independent shops (greenfield)",
  },
];

export const NARROW_MONITOR_COUNT = METROS.reduce(
  (n, m) => n + m.narrowEventTypes.length,
  0
);
