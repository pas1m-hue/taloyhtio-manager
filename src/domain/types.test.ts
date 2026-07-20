import { expect, it } from "vitest";

import type {
  Asset,
  BuildingEvent,
  EventOrigin,
  FutureBuildingEvent,
} from "./types.js";

const asset = {
  id: "asset_facade",
  name: "Julkisivu",
  category: "envelope",
  sourceIds: ["initial_excel"],
  active: true,
} as const satisfies Asset;

const event = {
  id: "event_facade_painting",
  assetId: asset.id,
  title: "Julkisivun huoltomaalaus",
  type: "maintenance",
  status: "approved",
  origin: "initial_excel",
  sourceIds: ["initial_excel"],
  schedule: [{
    id: "base_2032",
    scenario: "base",
    year: 2032,
    costEvidenceId: "gap_facade_painting",
  }],
} as const satisfies FutureBuildingEvent;

// V1.8 retains the V1.7 decision and removes generator and lifecycle inference fields.
// @ts-expect-error Asset has no generatorType.
const invalidGeneratorAsset: Asset = { ...asset, generatorType: "recurring" };
// @ts-expect-error Asset has no lifecycle interval fields.
const invalidLifecycleAsset: Asset = { ...asset, lifeMinYears: 10 };
// @ts-expect-error Events have no relation fields.
const invalidRelationEvent: BuildingEvent = { ...event, resetsCycleOf: ["x"] };
// @ts-expect-error There is no scenario-membership inference field.
const invalidMembershipEvent: BuildingEvent = { ...event, membership: "all" };

it("keeps the V1.8 domain event-centred at compile time", () => {
  expect(asset.id).toBe("asset_facade");
  expect(event.schedule).toHaveLength(1);
  expect(invalidGeneratorAsset.id).toBe(asset.id);
  expect(invalidLifecycleAsset.id).toBe(asset.id);
  expect(invalidRelationEvent.id).toBe(event.id);
  expect(invalidMembershipEvent.id).toBe(event.id);
  expect(invalidAiOrigin).toBe("llm_suggestion");
});


// The application records document provenance, not the administrator's tool choice.
// @ts-expect-error AI-specific provenance is not part of the V2.1 domain.
const invalidAiOrigin: EventOrigin = "llm_suggestion";

const validCollectionResult = {
  scenario: "base",
  knownCostRequiredAnnualCollection: 10_000,
  currentAnnualRepairCollection: 8_000,
  additionalAnnualCollection: 2_000,
  currentMonthlyCollection: 666.67,
  requiredMonthlyCollection: 833.34,
  additionalMonthlyCollection: 166.67,
  planningYearCount: 10,
  forecastComplete: true,
  blockingDataGaps: [],
} as const;

// V1.9 reports funding pressure but does not model a selected loan.
const invalidLoanResult: import("./types.js").RequiredCollectionResult = {
  ...validCollectionResult,
  // @ts-expect-error loanAmount is not part of the V1.9 collection result.
  loanAmount: 50_000,
};

it("keeps loan and interest assumptions outside the V1.9 liquidity result", () => {
  expect(validCollectionResult.additionalAnnualCollection).toBe(2_000);
  expect(invalidLoanResult.scenario).toBe("base");
});
