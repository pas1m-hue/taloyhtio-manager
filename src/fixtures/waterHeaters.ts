import type {
  Asset,
  BuildingEvent,
  CostEvidence,
  EventScheduleEntry,
  Scenario,
} from "../domain/types.js";

const SOURCE_URL =
  "https://docs.google.com/document/d/1OYxnb8APDA3pTm05HfcjqQJ-kWwS3rZSTIy-DbO2VRE/edit?usp=drivesdk";

export const waterHeaterAsset: Asset = {
  id: "asset_water_heaters",
  name: "Lämminvesivaraajat",
  category: "hvac",
  sourceIds: ["maintenance_need_statement_2024", "water_heater_quote_2026"],
  active: true,
};

export const waterHeaterCostEvidence: CostEvidence = {
  id: "K003",
  assetId: waterHeaterAsset.id,
  eventId: "event_water_heater_explicit_schedule",
  status: "quote",
  amount: 1_650,
  unit: "one_installed_water_heater",
  quantity: 1,
  priceLevelYear: 2026,
  vatIncluded: true,
  observedAt: "2026-05-26",
  validUntil: "2026-05-31",
  sourceUrl: SOURCE_URL,
  notes:
    "Jäspi VLM 300S-Space, 270 l, installed. Used only as evidence for explicitly entered annual rows.",
};

const distributions: Readonly<Record<Scenario, readonly [number, number][]>> = {
  optimistic: [
    [2027, 1],
    [2030, 1],
    [2033, 1],
    [2036, 1],
    [2039, 1],
  ],
  base: [
    [2027, 1],
    [2028, 1],
    [2029, 2],
    [2030, 2],
    [2031, 2],
    [2032, 1],
    [2033, 1],
    [2034, 1],
    [2035, 1],
  ],
  stress: [
    [2028, 5],
    [2029, 2],
    [2030, 2],
    [2031, 2],
    [2032, 1],
  ],
};

function explicitRows(): readonly EventScheduleEntry[] {
  return (Object.entries(distributions) as [Scenario, readonly [number, number][]][]) 
    .flatMap(([scenario, rows]) => rows.map(([year, quantity]) => ({
      id: `${scenario}_${year}`,
      scenario,
      year,
      quantity,
      amount: quantity * 1_650,
      costEvidenceId: waterHeaterCostEvidence.id,
      explanation:
        `Explicit ${scenario} Excel row: ${quantity} water heater(s) in ${year}.`,
    })));
}

/**
 * The old population distribution is now just an approved event containing
 * explicit annual rows. No quantity, failure-rate, or lifecycle logic runs.
 */
export const waterHeaterExplicitScheduleEvent: BuildingEvent = {
  id: "event_water_heater_explicit_schedule",
  assetId: waterHeaterAsset.id,
  title: "Lämminvesivaraajien eksplisiittinen vaihtosuunnitelma",
  type: "replacement",
  status: "approved",
  origin: "initial_excel",
  sourceIds: ["long_term_water_heater_scenarios"],
  schedule: explicitRows(),
  notes:
    "Twelve remaining heaters are represented only by rows copied from the corrected workbook.",
};

/** 2026 quote / decision pending: visible for review, not in calculations. */
export const waterHeater2026Suggestion: BuildingEvent = {
  id: "event_water_heater_c9_2026",
  assetId: waterHeaterAsset.id,
  title: "Lämminvesivaraaja C9 – Jäspi VLM 300S-Space",
  type: "replacement",
  status: "suggested",
  origin: "initial_excel",
  sourceIds: ["water_heater_quote_2026"],
  schedule: [{
    id: "base_2026",
    scenario: "base",
    year: 2026,
    amount: 1_650,
    quantity: 1,
    costEvidenceId: waterHeaterCostEvidence.id,
  }],
  notes: "Tarjous / päätös kesken.",
};
