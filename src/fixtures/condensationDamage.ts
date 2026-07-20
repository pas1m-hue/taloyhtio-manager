import type {
  Asset,
  BuildingEvent,
  CostEvidence,
  Observation,
} from "../domain/types.js";

const SOURCE_URL =
  "https://docs.google.com/document/d/1OYxnb8APDA3pTm05HfcjqQJ-kWwS3rZSTIy-DbO2VRE/edit?usp=drivesdk";

export const condensationAsset: Asset = {
  id: "asset_apartment_iv_condensation",
  name: "Huoneistojen IV-putkien eristys ja kondenssivauriot",
  category: "hvac",
  sourceIds: ["housing_company_record_2025_2026"],
  active: true,
};

export const condensationObservations: readonly Observation[] = [
  {
    id: "observation_condensation_b4_2025",
    assetId: condensationAsset.id,
    observedAt: "2025-Q4",
    description: "B4 toteutunut vastaava kondenssivauriokorjaus.",
    sourceIds: ["housing_company_record_2025_2026"],
  },
  ...["a2", "a3", "b6"].map((apartment) => ({
    id: `observation_condensation_${apartment}_2026`,
    assetId: condensationAsset.id,
    observedAt: "2026-07-16",
    description: `${apartment.toUpperCase()} mahdollinen vastaava korjaus.`,
    sourceIds: ["housing_company_record_2025_2026"],
  })),
];

export const condensationCostEvidence: readonly CostEvidence[] = [
  {
    id: "K001",
    assetId: condensationAsset.id,
    eventId: "event_condensation_b4_actual_2025",
    status: "actual",
    amount: 1_545,
    unit: "one_apartment_total",
    quantity: 1,
    priceLevelYear: 2025,
    observedAt: "2025-Q4",
    sourceUrl: SOURCE_URL,
  },
  {
    id: "K002",
    assetId: condensationAsset.id,
    eventId: "event_condensation_a2_a3_b6_2026",
    status: "estimate_from_actual",
    amount: 4_635,
    unit: "three_apartments_total",
    quantity: 3,
    priceLevelYear: 2026,
    observedAt: "2026-07-16",
    sourceUrl: SOURCE_URL,
  },
  {
    id: "K_CONDENSATION_GAP",
    assetId: condensationAsset.id,
    eventId: "event_condensation_wider_damage_2026",
    status: "data_gap",
    unit: "open_scope_total",
    priceLevelYear: 2026,
    sourceUrl: SOURCE_URL,
    notes: "Laajuus ja kustannus puuttuvat.",
  },
];

export const condensationEvents: readonly BuildingEvent[] = [
  {
    id: "event_condensation_b4_actual_2025",
    assetId: condensationAsset.id,
    title: "B4 IV-putkien eristys ja kondenssivauriokorjaus",
    type: "repair",
    status: "actual",
    origin: "initial_excel",
    sourceIds: ["housing_company_record_2025_2026"],
    observationIds: ["observation_condensation_b4_2025"],
    actual: {
      year: 2025,
      occurredAt: "2025-Q4",
      amount: 1_545,
      quantity: 1,
      costEvidenceId: "K001",
    },
  },
  {
    id: "event_condensation_a2_a3_b6_2026",
    assetId: condensationAsset.id,
    title: "IV-putkien eristys ja kondenssivaurioiden korjaus, 3 asuntoa",
    type: "repair",
    status: "approved",
    origin: "initial_excel",
    sourceIds: ["housing_company_record_2025_2026"],
    observationIds: [
      "observation_condensation_a2_2026",
      "observation_condensation_a3_2026",
      "observation_condensation_b6_2026",
    ],
    schedule: [
      {
        id: "base_2026",
        scenario: "base",
        year: 2026,
        amount: 4_635,
        quantity: 3,
        costEvidenceId: "K002",
      },
      {
        id: "stress_2026",
        scenario: "stress",
        year: 2026,
        amount: 4_635,
        quantity: 3,
        costEvidenceId: "K002",
      },
    ],
  },
  {
    id: "event_condensation_wider_damage_2026",
    assetId: condensationAsset.id,
    title: "Laajempi vaurio / ammattilaiskoordinaatio",
    type: "repair",
    status: "approved",
    origin: "initial_excel",
    sourceIds: ["housing_company_record_2025_2026"],
    schedule: [{
      id: "stress_2026",
      scenario: "stress",
      year: 2026,
      costEvidenceId: "K_CONDENSATION_GAP",
    }],
  },
];
