import type {
  Asset,
  BuildingEvent,
  CostEvidence,
  EventScheduleEntry,
  Scenario,
} from "../domain/types.js";

interface DefaultRow {
  readonly id: string;
  readonly title: string;
  readonly category: Asset["category"];
  readonly type: BuildingEvent["type"];
  readonly years: Readonly<Record<Scenario, number>>;
  readonly source: string;
  readonly notes?: string;
}

const rows: readonly DefaultRow[] = [
  {
    id: "yard_asphalt",
    title: "Piha-asfaltti – uusiminen",
    category: "yard",
    type: "renewal",
    years: { stress: 2032, base: 2032, optimistic: 2032 },
    source: "board_report_2024_p15",
  },
  {
    id: "balcony_soffit_treatment",
    title: "Parvekkeiden alapintojen käsittely",
    category: "envelope",
    type: "maintenance",
    years: { stress: 2025, base: 2028, optimistic: 2030 },
    source: "board_report_2024_p15",
  },
  {
    id: "ventilation_maintenance",
    title: "Ilmastointihormit ja -koneet – huolto",
    category: "hvac",
    type: "maintenance",
    years: { stress: 2031, base: 2034, optimistic: 2036 },
    source: "board_report_2024_p15",
    notes: "V1.7 stores only this explicit next event; no later cycles are generated.",
  },
  {
    id: "drain_inspection",
    title: "Viemärilinjat ja kaivot – tarkastus",
    category: "hvac",
    type: "inspection",
    years: { stress: 2023, base: 2026, optimistic: 2028 },
    source: "board_report_2024_p15",
  },
  {
    id: "exterior_wall_painting",
    title: "Ulkoseinien huoltomaalaus",
    category: "envelope",
    type: "maintenance",
    years: { stress: 2029, base: 2032, optimistic: 2034 },
    source: "board_report_2024_p15",
  },
  {
    id: "roof_maintenance",
    title: "Vesikate – huolto",
    category: "envelope",
    type: "maintenance",
    years: { stress: 2026, base: 2029, optimistic: 2031 },
    source: "board_report_2024_p15",
  },
  {
    id: "smoke_detectors",
    title: "Palovaroittimet – uusiminen",
    category: "safety",
    type: "replacement",
    years: { stress: 2035, base: 2035, optimistic: 2035 },
    source: "board_report_2024_p15",
  },
  {
    id: "domestic_water_pipes",
    title: "Käyttövesiputket – uusiminen",
    category: "hvac",
    type: "renewal",
    years: { stress: 2032, base: 2045, optimistic: 2057 },
    source: "board_report_2024_p15",
  },
  {
    id: "drainage_system",
    title: "Salaojajärjestelmä – uusiminen",
    category: "structures",
    type: "renewal",
    years: { stress: 2037, base: 2047, optimistic: 2057 },
    source: "board_report_2024_p15",
  },
  {
    id: "facade_timber_structure",
    title: "Julkisivu, puuverhousrakenne – uusiminen",
    category: "envelope",
    type: "renewal",
    years: { stress: 2037, base: 2047, optimistic: 2057 },
    source: "board_report_2024_p15",
    notes: "Independent from the exterior-wall painting event.",
  },
  {
    id: "foundations",
    title: "Perustukset – kunnostus",
    category: "structures",
    type: "renewal",
    years: { stress: 2057, base: 2062, optimistic: 2067 },
    source: "board_report_2024_p15",
  },
  {
    id: "roof_full_renewal",
    title: "Vesikate – täysi uusiminen",
    category: "envelope",
    type: "renewal",
    years: { stress: 2047, base: 2057, optimistic: 2067 },
    source: "board_report_2024_p15",
  },
];

function entries(row: DefaultRow): readonly EventScheduleEntry[] {
  return (["optimistic", "base", "stress"] as const).map((scenario) => ({
    id: `${scenario}_${row.years[scenario]}`,
    scenario,
    year: row.years[scenario],
    costEvidenceId: `gap_${row.id}`,
    explanation: "Original Excel default year; cost remains a named DATA GAP.",
  }));
}

export const initialExcelAssets: readonly Asset[] = rows.map((row) => ({
  id: `asset_${row.id}`,
  name: row.title,
  category: row.category,
  sourceIds: [row.source],
  active: true,
}));

export const initialExcelEvents: readonly BuildingEvent[] = rows.map((row) => ({
  id: `event_${row.id}`,
  assetId: `asset_${row.id}`,
  title: row.title,
  type: row.type,
  status: "approved",
  origin: "initial_excel",
  sourceIds: [row.source],
  schedule: entries(row),
  ...(row.notes === undefined ? {} : { notes: row.notes }),
}));

export const initialExcelCostGaps: readonly CostEvidence[] = rows.map((row) => ({
  id: `gap_${row.id}`,
  assetId: `asset_${row.id}`,
  eventId: `event_${row.id}`,
  status: "data_gap",
  unit: "project_total",
  priceLevelYear: 2026,
  sourceId: row.source,
  notes: "The original workbook supplies timing but no selected numeric cost.",
}));
