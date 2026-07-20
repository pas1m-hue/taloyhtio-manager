import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  type Asset,
  type BuildingEvent,
  type CostEvidence,
  type FutureBuildingEvent,
} from "../domain/types.js";
import {
  condensationAsset,
  condensationCostEvidence,
  condensationEvents,
} from "../fixtures/condensationDamage.js";
import {
  initialExcelAssets,
  initialExcelCostGaps,
  initialExcelEvents,
} from "../fixtures/initialExcelDefaults.js";
import {
  waterHeater2026Suggestion,
  waterHeaterAsset,
  waterHeaterCostEvidence,
  waterHeaterExplicitScheduleEvent,
} from "../fixtures/waterHeaters.js";
import { projectEvents } from "./projectEvents.js";

const horizon = { startYear: 2026, endYear: 2040 } as const;

const facadeAsset: Asset = {
  id: "asset_facade",
  name: "Julkisivu",
  category: "envelope",
  sourceIds: ["manual_register"],
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

function expectDomainError(
  action: () => unknown,
  code: DomainValidationError["code"],
): void {
  try {
    action();
    throw new Error("Expected DomainValidationError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).code).toBe(code);
  }
}

function baseInput(overrides: Partial<Parameters<typeof projectEvents>[0]> = {}) {
  return {
    assets: [facadeAsset],
    events: facadeEvents,
    costEvidence: facadeEvidence,
    horizon,
    ...overrides,
  };
}

describe("projectEvents — explicit independent events", () => {
  it("keeps facade painting and facade renewal as independent rows", () => {
    const result = projectEvents(baseInput());

    expect(result.events.map(({ eventId, year, amount }) => ({
      eventId,
      year,
      amount,
    }))).toEqual([
      { eventId: "event_facade_painting", year: 2032, amount: 25_000 },
      { eventId: "event_facade_renewal", year: 2040, amount: 150_000 },
    ]);
  });

  it("does not create a second maintenance cycle from one explicit row", () => {
    const result = projectEvents(baseInput({
      events: [facadeEvents[0]!],
      costEvidence: [facadeEvidence[0]!],
      horizon: { startYear: 2026, endYear: 2070 },
    }));

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.year).toBe(2032);
  });

  it("does not let one event delete, reset, or move another event", () => {
    const reversed = projectEvents(baseInput({ events: [...facadeEvents].reverse() }));
    const normal = projectEvents(baseInput());

    expect(reversed).toEqual(normal);
    expect(normal.events.map((event) => event.eventId)).toEqual([
      "event_facade_painting",
      "event_facade_renewal",
    ]);
  });

  it("uses exact scenario rows without membership or timing inference", () => {
    const event: FutureBuildingEvent = {
      ...facadeEvents[0] as FutureBuildingEvent,
      id: "event_exact_scenarios",
      title: "Täsmälliset skenaariorivit",
      schedule: [
        {
          id: "stress_2028",
          scenario: "stress",
          year: 2028,
          amount: 30_000,
          costEvidenceId: "cost_exact",
        },
        {
          id: "optimistic_2035",
          scenario: "optimistic",
          year: 2035,
          amount: 20_000,
          costEvidenceId: "cost_exact",
        },
      ],
    };
    const evidence: CostEvidence = {
      id: "cost_exact",
      assetId: facadeAsset.id,
      eventId: event.id,
      status: "estimate",
      amount: 25_000,
      unit: "project_total",
      priceLevelYear: 2026,
      sourceId: "manual_estimate",
    };
    const result = projectEvents(baseInput({ events: [event], costEvidence: [evidence] }));

    expect(result.events.map(({ scenario, year, amount }) => ({
      scenario,
      year,
      amount,
    }))).toEqual([
      { scenario: "stress", year: 2028, amount: 30_000 },
      { scenario: "optimistic", year: 2035, amount: 20_000 },
    ]);
  });

  it("allows several explicit rows in the same scenario", () => {
    const event: FutureBuildingEvent = {
      ...facadeEvents[0] as FutureBuildingEvent,
      id: "event_multirow",
      schedule: [2030, 2032, 2034].map((year) => ({
        id: `base_${year}`,
        scenario: "base" as const,
        year,
        amount: 1_000,
        costEvidenceId: "cost_multirow",
      })),
    };
    const evidence: CostEvidence = {
      id: "cost_multirow",
      assetId: facadeAsset.id,
      eventId: event.id,
      status: "estimate",
      amount: 1_000,
      unit: "explicit_row_total",
      priceLevelYear: 2026,
      sourceId: "manual_estimate",
    };

    expect(projectEvents(baseInput({ events: [event], costEvidence: [evidence] }))
      .events.map((row) => row.year)).toEqual([2030, 2032, 2034]);
  });
});

describe("projectEvents — status and origin workflow", () => {
  it("includes approved initial-Excel and manual events in calculations", () => {
    const manual = facadeEvents[0]!;
    const initial: BuildingEvent = {
      ...facadeEvents[1]! as FutureBuildingEvent,
      origin: "initial_excel",
    };
    const result = projectEvents(baseInput({ events: [initial, manual] }));

    expect(result.events.map((event) => event.origin)).toEqual([
      "manual",
      "initial_excel",
    ]);
  });

  it("queues a document-update suggestion without adding it to costs", () => {
    const suggestion: BuildingEvent = {
      ...facadeEvents[0]! as FutureBuildingEvent,
      id: "event_document_update",
      status: "suggested",
      origin: "document_update",
      schedule: [{
        id: "base_2031",
        scenario: "base",
        year: 2031,
        costEvidenceId: "not_yet_priced",
      }],
    };
    const result = projectEvents(baseInput({
      events: [suggestion],
      costEvidence: [],
    }));

    expect(result.events).toEqual([]);
    expect(result.suggestions).toEqual([suggestion]);
  });

  it("keeps actuals in history and does not project them again", () => {
    const result = projectEvents({
      assets: [condensationAsset],
      events: [condensationEvents[0]!],
      costEvidence: [condensationCostEvidence[0]!],
      horizon,
    });

    expect(result.events).toEqual([]);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]?.actual).toMatchObject({ year: 2025, amount: 1_545 });
  });

  it("requires actual cost evidence for an actual historical event", () => {
    expectDomainError(
      () => projectEvents({
        assets: [condensationAsset],
        events: [condensationEvents[0]!],
        costEvidence: [{ ...condensationCostEvidence[0]!, status: "estimate" }],
        horizon,
      }),
      "COST_EVIDENCE_MISMATCH",
    );
  });

  it("keeps cancelled events out of calculations", () => {
    const cancelled: BuildingEvent = {
      id: "event_cancelled",
      assetId: facadeAsset.id,
      title: "Peruttu tapahtuma",
      type: "repair",
      status: "cancelled",
      origin: "manual",
      sourceIds: ["board_minutes"],
      schedule: [{
        id: "base_2030",
        scenario: "base",
        year: 2030,
        amount: 99_000,
        costEvidenceId: "unused",
      }],
    };
    const result = projectEvents(baseInput({ events: [cancelled], costEvidence: [] }));

    expect(result.events).toEqual([]);
    expect(result.cancelled).toEqual([cancelled]);
  });
});

describe("projectEvents — real workbook fixtures", () => {
  it("projects the three-apartment condensation estimate and preserves DATA GAP", () => {
    const result = projectEvents({
      assets: [condensationAsset],
      events: condensationEvents,
      costEvidence: condensationCostEvidence,
      horizon,
    });

    expect(result.history).toHaveLength(1);
    expect(result.events.map(({ scenario, amount, quantity }) => ({
      scenario,
      amount,
      quantity,
    }))).toEqual([
      { scenario: "base", amount: 4_635, quantity: 3 },
      { scenario: "stress", amount: 4_635, quantity: 3 },
    ]);
    expect(result.dataGaps).toEqual([
      expect.objectContaining({
        eventId: "event_condensation_wider_damage_2026",
        scenario: "stress",
        year: 2026,
        horizonPosition: "within",
      }),
    ]);
  });

  it("uses the 12-water-heater paths as explicit rows only", () => {
    const result = projectEvents({
      assets: [waterHeaterAsset],
      events: [waterHeaterExplicitScheduleEvent, waterHeater2026Suggestion],
      costEvidence: [waterHeaterCostEvidence],
      horizon: { startYear: 2026, endYear: 2040 },
    });
    const base = result.events.filter((event) => event.scenario === "base");

    expect(base.reduce((sum, event) => sum + (event.quantity ?? 0), 0)).toBe(12);
    expect(base.reduce((sum, event) => sum + event.amount, 0)).toBe(19_800);
    expect(base.map(({ year, quantity }) => ({ year, quantity }))).toEqual([
      { year: 2027, quantity: 1 },
      { year: 2028, quantity: 1 },
      { year: 2029, quantity: 2 },
      { year: 2030, quantity: 2 },
      { year: 2031, quantity: 2 },
      { year: 2032, quantity: 1 },
      { year: 2033, quantity: 1 },
      { year: 2034, quantity: 1 },
      { year: 2035, quantity: 1 },
    ]);
    expect(result.suggestions).toEqual([waterHeater2026Suggestion]);
  });

  it("imports original building-component dates as independent DATA GAP defaults", () => {
    const result = projectEvents({
      assets: initialExcelAssets,
      events: initialExcelEvents,
      costEvidence: initialExcelCostGaps,
      horizon,
    });

    expect(result.events).toEqual([]);
    expect(result.dataGaps).toHaveLength(initialExcelEvents.length * 3);
    expect(result.dataGaps.some((gap) =>
      gap.eventId === "event_exterior_wall_painting" && gap.year === 2032
    )).toBe(true);
    expect(result.dataGaps.some((gap) =>
      gap.eventId === "event_facade_timber_structure" && gap.year === 2047
    )).toBe(true);
  });
});

describe("projectEvents — horizon and traceability", () => {
  it("separates before, within, and after rows inclusively", () => {
    const event: FutureBuildingEvent = {
      ...facadeEvents[0]! as FutureBuildingEvent,
      id: "event_horizon",
      schedule: [
        ["before", 2025],
        ["start", 2026],
        ["end", 2040],
        ["after", 2041],
      ].map(([id, year]) => ({
        id: String(id),
        scenario: "base" as const,
        year: Number(year),
        amount: 1_000,
        costEvidenceId: "cost_horizon",
      })),
    };
    const evidence: CostEvidence = {
      id: "cost_horizon",
      assetId: facadeAsset.id,
      eventId: event.id,
      status: "estimate",
      amount: 1_000,
      unit: "row_total",
      priceLevelYear: 2026,
      sourceId: "estimate",
    };
    const result = projectEvents(baseInput({ events: [event], costEvidence: [evidence] }));

    expect(result.beforeHorizon.base.events.map((row) => row.year)).toEqual([2025]);
    expect(result.events.map((row) => row.year)).toEqual([2026, 2040]);
    expect(result.afterHorizon.base.events.map((row) => row.year)).toEqual([2041]);
  });

  it("sorts observation ids and produces deterministic output", () => {
    const event: FutureBuildingEvent = {
      ...facadeEvents[0]! as FutureBuildingEvent,
      observationIds: ["obs_z", "obs_a"],
    };
    const first = projectEvents(baseInput({ events: [event] }));
    const second = projectEvents(baseInput({ events: [event] }));

    expect(first).toEqual(second);
    expect(first.events[0]?.observationIds).toEqual(["obs_a", "obs_z"]);
  });

  it("keeps event and cost evidence identifiers on every projected row", () => {
    const result = projectEvents(baseInput());
    expect(result.events.every((row) =>
      row.eventId.length > 0 && row.scheduleEntryId.length > 0 &&
      row.costEvidenceId.length > 0
    )).toBe(true);
  });

  it("accepts old projection evidence only with explicit 2026 confirmation", () => {
    const oldEvidence: CostEvidence = { ...facadeEvidence[0]!, priceLevelYear: 2024 };
    expectDomainError(
      () => projectEvents(baseInput({
        events: [facadeEvents[0]!],
        costEvidence: [oldEvidence],
      })),
      "UNCONFIRMED_PRICE_LEVEL",
    );

    expect(projectEvents(baseInput({
      events: [facadeEvents[0]!],
      costEvidence: [oldEvidence],
      priceLevelConfirmations: [{
        costEvidenceId: oldEvidence.id,
        targetYear: 2026,
        confirmedAt: "2026-07-17",
        confirmedBy: "board-user",
      }],
    })).events).toHaveLength(1);
  });
});

describe("projectEvents — validation", () => {
  it("rejects invalid horizon", () => {
    expectDomainError(
      () => projectEvents(baseInput({ horizon: { startYear: 2041, endYear: 2040 } })),
      "INVALID_HORIZON",
    );
  });

  it("rejects duplicate asset, event, schedule-entry, and evidence ids", () => {
    expectDomainError(
      () => projectEvents(baseInput({ assets: [facadeAsset, facadeAsset] })),
      "DUPLICATE_ASSET_ID",
    );
    expectDomainError(
      () => projectEvents(baseInput({ events: [facadeEvents[0]!, facadeEvents[0]!] })),
      "DUPLICATE_EVENT_ID",
    );
    const duplicateSchedule: FutureBuildingEvent = {
      ...facadeEvents[0]! as FutureBuildingEvent,
      schedule: [
        (facadeEvents[0] as FutureBuildingEvent).schedule[0]!,
        (facadeEvents[0] as FutureBuildingEvent).schedule[0]!,
      ],
    };
    expectDomainError(
      () => projectEvents(baseInput({ events: [duplicateSchedule] })),
      "DUPLICATE_SCHEDULE_ENTRY_ID",
    );
    expectDomainError(
      () => projectEvents(baseInput({
        events: [facadeEvents[0]!],
        costEvidence: [facadeEvidence[0]!, facadeEvidence[0]!],
      })),
      "DUPLICATE_COST_EVIDENCE_ID",
    );
  });

  it("rejects missing or inactive assets", () => {
    expectDomainError(
      () => projectEvents(baseInput({ assets: [] })),
      "MISSING_ASSET",
    );
    expectDomainError(
      () => projectEvents(baseInput({ assets: [{ ...facadeAsset, active: false }] })),
      "INACTIVE_ASSET",
    );
  });

  it("rejects source-less events and cost evidence", () => {
    expectDomainError(
      () => projectEvents(baseInput({
        events: [{ ...facadeEvents[0]!, sourceIds: [] }],
        costEvidence: [facadeEvidence[0]!],
      })),
      "MISSING_EVENT_SOURCE",
    );
    const { sourceId: _sourceId, sourceUrl: _sourceUrl, ...sourceLess } =
      facadeEvidence[0]!;
    expectDomainError(
      () => projectEvents(baseInput({
        events: [facadeEvents[0]!],
        costEvidence: [sourceLess],
      })),
      "MISSING_COST_SOURCE",
    );
  });

  it("rejects invalid years, quantities, and amounts", () => {
    for (const [entry, code] of [
      [{ ...((facadeEvents[0] as FutureBuildingEvent).schedule[0]!), year: 2032.5 }, "INVALID_EVENT_YEAR"],
      [{ ...((facadeEvents[0] as FutureBuildingEvent).schedule[0]!), quantity: 0 }, "INVALID_EVENT_QUANTITY"],
      [{ ...((facadeEvents[0] as FutureBuildingEvent).schedule[0]!), amount: -1 }, "INVALID_EVENT_AMOUNT"],
    ] as const) {
      expectDomainError(
        () => projectEvents(baseInput({
          events: [{ ...facadeEvents[0]! as FutureBuildingEvent, schedule: [entry] }],
          costEvidence: [facadeEvidence[0]!],
        })),
        code,
      );
    }
  });

  it("requires an explicit schedule for future events", () => {
    expectDomainError(
      () => projectEvents(baseInput({
        events: [{ ...facadeEvents[0]! as FutureBuildingEvent, schedule: [] }],
        costEvidence: [],
      })),
      "INVALID_EVENT_SCHEDULE",
    );
  });

  it("rejects missing and mismatched cost evidence", () => {
    expectDomainError(
      () => projectEvents(baseInput({ events: [facadeEvents[0]!], costEvidence: [] })),
      "MISSING_COST_EVIDENCE",
    );
    expectDomainError(
      () => projectEvents(baseInput({
        events: [facadeEvents[0]!],
        costEvidence: [{ ...facadeEvidence[0]!, eventId: "other_event" }],
      })),
      "COST_EVIDENCE_MISMATCH",
    );
  });

  it("rejects numeric rows backed by DATA GAP and missing amounts backed by numeric evidence", () => {
    expectDomainError(
      () => projectEvents(baseInput({
        events: [facadeEvents[0]!],
        costEvidence: [{ ...facadeEvidence[0]!, status: "data_gap" }],
      })),
      "INVALID_DATA_GAP",
    );
    const missingAmount: FutureBuildingEvent = {
      ...facadeEvents[0]! as FutureBuildingEvent,
      schedule: [{
        ...((facadeEvents[0] as FutureBuildingEvent).schedule[0]!),
        amount: undefined,
      }] as unknown as FutureBuildingEvent["schedule"],
    };
    expectDomainError(
      () => projectEvents(baseInput({
        events: [missingAmount],
        costEvidence: [facadeEvidence[0]!],
      })),
      "INVALID_DATA_GAP",
    );
  });
});
