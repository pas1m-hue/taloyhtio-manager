import { describe, expect, it } from "vitest";

import type {
  Asset,
  BuildingEvent,
  CostEvidence,
  EventDataGap,
  FutureBuildingEvent,
  ProjectedCostEvent,
} from "../domain/types.js";
import {
  condensationAsset,
  condensationCostEvidence,
  condensationEvents,
} from "../fixtures/condensationDamage.js";
import {
  waterHeater2026Suggestion,
  waterHeaterAsset,
  waterHeaterCostEvidence,
  waterHeaterExplicitScheduleEvent,
} from "../fixtures/waterHeaters.js";
import { aggregateByYear } from "./aggregateByYear.js";
import { buildProjection } from "./buildProjection.js";

const horizon = { startYear: 2026, endYear: 2040 } as const;

const facadeAsset: Asset = {
  id: "asset_facade",
  name: "Julkisivu",
  category: "envelope",
  sourceIds: ["board_plan_2026"],
  active: true,
};

const facadeEvidence: readonly CostEvidence[] = [
  {
    id: "cost_facade_painting",
    assetId: facadeAsset.id,
    eventId: "event_facade_painting",
    status: "estimate",
    amount: 25_000,
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "cost_plan_2026",
  },
  {
    id: "cost_facade_renewal",
    assetId: facadeAsset.id,
    eventId: "event_facade_renewal",
    status: "estimate",
    amount: 150_000,
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "condition_assessment_2026",
  },
];

const facadeEvents: readonly BuildingEvent[] = [
  {
    id: "event_facade_painting",
    assetId: facadeAsset.id,
    title: "Julkisivun huoltomaalaus",
    type: "maintenance",
    status: "approved",
    origin: "manual",
    sourceIds: ["board_plan_2026"],
    schedule: [{
      id: "base_2032",
      scenario: "base",
      year: 2032,
      amount: 25_000,
      costEvidenceId: "cost_facade_painting",
    }],
  },
  {
    id: "event_facade_renewal",
    assetId: facadeAsset.id,
    title: "Julkisivun täydellinen uusiminen",
    type: "renewal",
    status: "approved",
    origin: "manual",
    sourceIds: ["board_plan_2026"],
    schedule: [{
      id: "base_2040",
      scenario: "base",
      year: 2040,
      amount: 150_000,
      costEvidenceId: "cost_facade_renewal",
    }],
  },
];

function facadeInput(overrides: Partial<Parameters<typeof buildProjection>[0]> = {}) {
  return {
    assets: [facadeAsset],
    events: facadeEvents,
    costEvidence: facadeEvidence,
    horizon,
    ...overrides,
  };
}

describe("aggregateByYear", () => {
  it("groups several events in the same scenario and year without merging rows", () => {
    const events: readonly ProjectedCostEvent[] = [
      projected("b", "event_b", "base", 2030, 2_000, 2),
      projected("a", "event_a", "base", 2030, 1_000, 1),
    ];

    const result = aggregateByYear({ events });

    expect(result.base).toEqual([{
      year: 2030,
      eventCount: 2,
      quantity: 3,
      amount: 3_000,
      events: [events[1], events[0]],
      dataGaps: [],
    }]);
  });

  it("keeps scenarios separate even when year is the same", () => {
    const result = aggregateByYear({
      events: [
        projected("o", "event_o", "optimistic", 2030, 10_000),
        projected("b", "event_b", "base", 2030, 20_000),
        projected("s", "event_s", "stress", 2030, 30_000),
      ],
    });

    expect(result.optimistic[0]?.amount).toBe(10_000);
    expect(result.base[0]?.amount).toBe(20_000);
    expect(result.stress[0]?.amount).toBe(30_000);
  });

  it("creates a visible year for a within-horizon DATA GAP without adding zero euros", () => {
    const gap: EventDataGap = {
      eventId: "event_gap",
      scheduleEntryId: "stress_2031",
      assetId: "asset_gap",
      title: "Avoin kustannus",
      scenario: "stress",
      year: 2031,
      costEvidenceId: "gap_1",
      horizonPosition: "within",
      reason: "Named gap",
    };

    const result = aggregateByYear({ events: [], dataGaps: [gap] });

    expect(result.stress).toEqual([{
      year: 2031,
      eventCount: 0,
      quantity: 0,
      amount: 0,
      events: [],
      dataGaps: [gap],
    }]);
  });

  it("does not put before- or after-horizon gaps into horizon year rows", () => {
    const gaps: readonly EventDataGap[] = ["before", "after"].map((position) => ({
      eventId: `event_${position}`,
      scheduleEntryId: `base_${position}`,
      assetId: "asset_gap",
      title: "Avoin kustannus",
      scenario: "base" as const,
      year: position === "before" ? 2020 : 2050,
      costEvidenceId: `gap_${position}`,
      horizonPosition: position as "before" | "after",
      reason: "Named gap",
    }));

    expect(aggregateByYear({ events: [], dataGaps: gaps }).base).toEqual([]);
  });
});

describe("buildProjection", () => {
  it("keeps facade painting and facade renewal as separate projection rows", () => {
    const result = buildProjection(facadeInput());

    expect(result.scenarios.base.years.map((year) => ({
      year: year.year,
      eventIds: year.events.map((event) => event.eventId),
      amount: year.amount,
    }))).toEqual([
      { year: 2032, eventIds: ["event_facade_painting"], amount: 25_000 },
      { year: 2040, eventIds: ["event_facade_renewal"], amount: 150_000 },
    ]);
    expect(result.scenarios.base.horizonAmount).toBe(175_000);
  });

  it("sums several independent events in the same year", () => {
    const secondEvent: FutureBuildingEvent = {
      id: "event_facade_study",
      assetId: facadeAsset.id,
      title: "Julkisivun kuntotutkimus",
      type: "study",
      status: "approved",
      origin: "manual",
      sourceIds: ["board_plan_2026"],
      schedule: [{
        id: "base_2032",
        scenario: "base",
        year: 2032,
        amount: 5_000,
        costEvidenceId: "cost_facade_study",
      }],
    };
    const evidence: CostEvidence = {
      id: "cost_facade_study",
      assetId: facadeAsset.id,
      eventId: secondEvent.id,
      status: "estimate",
      amount: 5_000,
      unit: "project_total",
      priceLevelYear: 2026,
      sourceId: "study_estimate",
    };

    const result = buildProjection(facadeInput({
      events: [facadeEvents[0]!, secondEvent],
      costEvidence: [facadeEvidence[0]!, evidence],
    }));

    expect(result.scenarios.base.years).toEqual([
      expect.objectContaining({ year: 2032, eventCount: 2, amount: 30_000 }),
    ]);
    expect(result.scenarios.base.years[0]?.events.map((event) => event.eventId))
      .toEqual(["event_facade_painting", "event_facade_study"]);
  });

  it("keeps optimistic, base, and stress totals isolated", () => {
    const event: FutureBuildingEvent = {
      ...facadeEvents[0] as FutureBuildingEvent,
      id: "event_three_scenarios",
      schedule: [
        { id: "optimistic_2030", scenario: "optimistic", year: 2030, amount: 10_000, costEvidenceId: "cost_three" },
        { id: "base_2030", scenario: "base", year: 2030, amount: 20_000, costEvidenceId: "cost_three" },
        { id: "stress_2030", scenario: "stress", year: 2030, amount: 30_000, costEvidenceId: "cost_three" },
      ],
    };
    const evidence: CostEvidence = {
      id: "cost_three",
      assetId: facadeAsset.id,
      eventId: event.id,
      status: "estimate",
      amount: 20_000,
      unit: "project_total",
      priceLevelYear: 2026,
      sourceId: "scenario_estimate",
    };

    const result = buildProjection(facadeInput({ events: [event], costEvidence: [evidence] }));

    expect(result.scenarios.optimistic.horizonAmount).toBe(10_000);
    expect(result.scenarios.base.horizonAmount).toBe(20_000);
    expect(result.scenarios.stress.horizonAmount).toBe(30_000);
  });

  it("aggregates the real water-heater base path to 12 units and EUR 19,800", () => {
    const result = buildProjection({
      assets: [waterHeaterAsset],
      events: [waterHeaterExplicitScheduleEvent],
      costEvidence: [waterHeaterCostEvidence],
      horizon: { startYear: 2027, endYear: 2039 },
    });

    expect(result.scenarios.base.horizonQuantity).toBe(12);
    expect(result.scenarios.base.horizonAmount).toBe(19_800);
    expect(result.scenarios.base.horizonEventCount).toBe(9);
    expect(result.scenarios.base.years.map((year) => year.year))
      .toEqual([2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035]);
  });

  it("reports the real condensation DATA GAP separately from numeric totals", () => {
    const result = buildProjection({
      assets: [condensationAsset],
      events: condensationEvents,
      costEvidence: condensationCostEvidence,
      horizon: { startYear: 2026, endYear: 2030 },
    });

    const stress2026 = result.scenarios.stress.years[0];
    expect(stress2026).toMatchObject({
      year: 2026,
      eventCount: 1,
      quantity: 3,
      amount: 4_635,
    });
    expect(stress2026?.dataGaps).toHaveLength(1);
    expect(result.scenarios.stress.horizonAmount).toBe(4_635);
    expect(result.scenarios.stress.dataGaps.withinHorizon).toHaveLength(1);
    expect(result.dataGaps).toHaveLength(1);
  });

  it("excludes suggestions from totals while retaining the review queue", () => {
    const result = buildProjection({
      assets: [waterHeaterAsset],
      events: [waterHeater2026Suggestion],
      costEvidence: [],
      horizon,
    });

    expect(result.scenarios.base.horizonAmount).toBe(0);
    expect(result.scenarios.base.years).toEqual([]);
    expect(result.suggestions.map((event) => event.id))
      .toEqual(["event_water_heater_c9_2026"]);
  });

  it("separates before-, within-, and after-horizon amounts", () => {
    const event: FutureBuildingEvent = {
      ...facadeEvents[0] as FutureBuildingEvent,
      id: "event_horizon_split",
      schedule: [
        { id: "base_2024", scenario: "base", year: 2024, amount: 1_000, costEvidenceId: "cost_split" },
        { id: "base_2030", scenario: "base", year: 2030, amount: 2_000, costEvidenceId: "cost_split" },
        { id: "base_2045", scenario: "base", year: 2045, amount: 3_000, costEvidenceId: "cost_split" },
      ],
    };
    const evidence: CostEvidence = {
      id: "cost_split",
      assetId: facadeAsset.id,
      eventId: event.id,
      status: "estimate",
      amount: 2_000,
      unit: "explicit_row_total",
      priceLevelYear: 2026,
      sourceId: "manual_estimate",
    };

    const result = buildProjection(facadeInput({ events: [event], costEvidence: [evidence] }));

    expect(result.scenarios.base.beforeHorizonAmount).toBe(1_000);
    expect(result.scenarios.base.horizonAmount).toBe(2_000);
    expect(result.scenarios.base.afterHorizonAmount).toBe(3_000);
    expect(result.scenarios.base.years.map((year) => year.year)).toEqual([2030]);
  });

  it("partitions DATA GAPs before, within, and after the horizon", () => {
    const event: FutureBuildingEvent = {
      ...facadeEvents[0] as FutureBuildingEvent,
      id: "event_gap_split",
      schedule: [
        { id: "base_2024", scenario: "base", year: 2024, costEvidenceId: "gap_split" },
        { id: "base_2030", scenario: "base", year: 2030, costEvidenceId: "gap_split" },
        { id: "base_2045", scenario: "base", year: 2045, costEvidenceId: "gap_split" },
      ],
    };
    const evidence: CostEvidence = {
      id: "gap_split",
      assetId: facadeAsset.id,
      eventId: event.id,
      status: "data_gap",
      unit: "project_total",
      priceLevelYear: 2026,
      sourceId: "board_plan_2026",
    };

    const result = buildProjection(facadeInput({ events: [event], costEvidence: [evidence] }));

    expect(result.scenarios.base.dataGaps.beforeHorizon).toHaveLength(1);
    expect(result.scenarios.base.dataGaps.withinHorizon).toHaveLength(1);
    expect(result.scenarios.base.dataGaps.afterHorizon).toHaveLength(1);
    expect(result.scenarios.base.years).toEqual([
      expect.objectContaining({ year: 2030, eventCount: 0, amount: 0 }),
    ]);
    expect(result.scenarios.base.years[0]?.dataGaps).toHaveLength(1);
  });

  it("is deterministic regardless of asset, event, evidence, and schedule input order", () => {
    const normal = buildProjection(facadeInput());
    const reversedEvents = facadeEvents.map((event) => event.status === "approved"
      ? { ...event, schedule: [...event.schedule].reverse() }
      : event).reverse();
    const reversed = buildProjection(facadeInput({
      assets: [facadeAsset].reverse(),
      events: reversedEvents,
      costEvidence: [...facadeEvidence].reverse(),
    }));

    expect(reversed).toEqual(normal);
  });

  it("does not mutate input arrays or event records", () => {
    const input = facadeInput();
    const before = JSON.stringify(input);

    buildProjection(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it("keeps status collections from the event portfolio", () => {
    const cancelled: BuildingEvent = {
      ...facadeEvents[0] as FutureBuildingEvent,
      id: "event_cancelled",
      status: "cancelled",
    };
    const result = buildProjection({
      assets: [facadeAsset, condensationAsset, waterHeaterAsset],
      events: [condensationEvents[0]!, waterHeater2026Suggestion, cancelled],
      costEvidence: [condensationCostEvidence[0]!],
      horizon,
    });

    expect(result.history.map((event) => event.id))
      .toEqual(["event_condensation_b4_actual_2025"]);
    expect(result.suggestions.map((event) => event.id))
      .toEqual(["event_water_heater_c9_2026"]);
    expect(result.cancelled.map((event) => event.id)).toEqual(["event_cancelled"]);
  });

  it("keeps every scenario total equal to the sum of its year rows", () => {
    const result = buildProjection({
      assets: [waterHeaterAsset, condensationAsset],
      events: [waterHeaterExplicitScheduleEvent, ...condensationEvents],
      costEvidence: [waterHeaterCostEvidence, ...condensationCostEvidence],
      horizon: { startYear: 2026, endYear: 2039 },
    });

    for (const scenario of ["optimistic", "base", "stress"] as const) {
      const scenarioResult = result.scenarios[scenario];
      expect(scenarioResult.horizonAmount).toBe(
        scenarioResult.years.reduce((sum, year) => sum + year.amount, 0),
      );
      expect(scenarioResult.horizonEventCount).toBe(
        scenarioResult.years.reduce((sum, year) => sum + year.eventCount, 0),
      );
      expect(scenarioResult.horizonQuantity).toBe(
        scenarioResult.years.reduce((sum, year) => sum + year.quantity, 0),
      );
    }
  });
});

function projected(
  id: string,
  eventId: string,
  scenario: ProjectedCostEvent["scenario"],
  year: number,
  amount: number,
  quantity?: number,
): ProjectedCostEvent {
  const base = {
    id,
    eventId,
    scheduleEntryId: id,
    assetId: "asset_test",
    title: eventId,
    type: "repair" as const,
    origin: "manual" as const,
    scenario,
    year,
    amount,
    costEvidenceId: "cost_test",
    explanation: "test",
  };
  return quantity === undefined ? base : { ...base, quantity };
}
