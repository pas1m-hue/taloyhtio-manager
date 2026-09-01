import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  type AdminDataBatchCommand,
  type Asset,
  type BuildingEvent,
  type CostEvidence,
  type FinancialYear,
  type LiquidityBaselineRecord,
} from "../domain/types.js";
import { buildProjection } from "../projection/buildProjection.js";
import { buildLiquidityForecast } from "../liquidity/buildLiquidityForecast.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { applyAdminBatch, createAdminDataSnapshot } from "./applyAdminBatch.js";
import { commitAdminBatch } from "./adminEntryService.js";
import { InMemoryAdminDataRepository } from "./adminRepository.js";

const ACTOR = "admin:pasi";
const NOW = "2026-07-17T16:00:00+03:00";

function command(
  operations: AdminDataBatchCommand["operations"],
  expectedRevision = adminBaselineSnapshot.revision,
): AdminDataBatchCommand {
  return {
    companyId: adminBaselineSnapshot.companyId,
    expectedRevision,
    actorId: ACTOR,
    occurredAt: NOW,
    operations,
  };
}

const newAsset: Asset = {
  id: "asset_manual_heat_pump",
  name: "Lämpöpumppu",
  category: "hvac",
  sourceIds: ["manual_admin_entry_2026"],
  active: true,
};

const newEvidence: CostEvidence = {
  id: "estimate_heat_pump_2030",
  assetId: newAsset.id,
  eventId: "event_manual_heat_pump_2030",
  status: "estimate",
  amount: 12_500,
  unit: "project_total",
  priceLevelYear: 2026,
  sourceId: "manual_admin_entry_2026",
};

const newEvent: BuildingEvent = {
  id: "event_manual_heat_pump_2030",
  assetId: newAsset.id,
  title: "Lämpöpumpun uusiminen",
  type: "replacement",
  status: "approved",
  origin: "manual",
  sourceIds: ["manual_admin_entry_2026"],
  schedule: [
    {
      id: "optimistic_2032",
      scenario: "optimistic",
      year: 2032,
      amount: 12_500,
      costEvidenceId: newEvidence.id,
    },
    {
      id: "base_2030",
      scenario: "base",
      year: 2030,
      amount: 12_500,
      costEvidenceId: newEvidence.id,
    },
    {
      id: "stress_2028",
      scenario: "stress",
      year: 2028,
      amount: 12_500,
      costEvidenceId: newEvidence.id,
    },
  ],
};

/**
 * Distributes over the operation union so each member drops its own metadata
 * keys. A plain Omit<Union, ...> collapses to the members' shared keys, which
 * since delete_entity (no `value` field) joined the union would reject every
 * save_* literal here.
 */
type WithoutOperationMetadata<T> = T extends unknown
  ? Omit<T, "sourceIds" | "explanation">
  : never;

function operation<T extends AdminDataBatchCommand["operations"][number]>(
  value: WithoutOperationMetadata<T>,
): T {
  return {
    ...value,
    sourceIds: ["admin_form_2026"],
    explanation: "Admin entered and reviewed the value manually.",
  } as unknown as T;
}

describe("V2.1 admin manual entry", () => {
  it("creates a valid immutable baseline at revision zero", () => {
    expect(adminBaselineSnapshot.revision).toBe(0);
    expect(adminBaselineSnapshot.events.length).toBeGreaterThan(0);
    expect(adminBaselineSnapshot.auditTrail).toEqual([]);
  });

  it("saves an asset, evidence, and event atomically regardless of operation order", () => {
    const next = applyAdminBatch(
      adminBaselineSnapshot,
      command([
        operation({ type: "save_building_event", value: newEvent }),
        operation({ type: "save_cost_evidence", value: newEvidence }),
        operation({ type: "save_asset", value: newAsset }),
      ]),
    );

    expect(next.revision).toBe(1);
    expect(next.assets.some((item) => item.id === newAsset.id)).toBe(true);
    expect(next.events.some((item) => item.id === newEvent.id)).toBe(true);
    expect(next.auditTrail).toHaveLength(3);
    expect(next.auditTrail.map((item) => item.operation)).toEqual([
      "create",
      "create",
      "create",
    ]);
  });

  it("rejects the complete batch and leaves the original snapshot untouched", () => {
    const invalidEvidence = { ...newEvidence, amount: -1 };
    expect(() => applyAdminBatch(
      adminBaselineSnapshot,
      command([
        operation({ type: "save_asset", value: newAsset }),
        operation({ type: "save_cost_evidence", value: invalidEvidence }),
        operation({ type: "save_building_event", value: newEvent }),
      ]),
    )).toThrowError(DomainValidationError);
    expect(adminBaselineSnapshot.revision).toBe(0);
    expect(adminBaselineSnapshot.assets.some((item) => item.id === newAsset.id))
      .toBe(false);
  });

  it("persists annual figures and a dated liquidity baseline", () => {
    const financialYear: FinancialYear = {
      year: 2026,
      budgetIncome: 62_000,
      budgetCosts: 55_000,
      sourceIds: ["budget_2026"],
    };
    const liquidity: LiquidityBaselineRecord = {
      id: "liquidity_2026_12_31",
      asOfDate: "2026-12-31",
      currentCash: 25_000,
      trailing12mOperatingCosts: 36_000,
      currentAnnualRepairCollection: 10_000,
      sourceIds: ["financial_statement_2026"],
    };
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_liquidity_baseline", value: liquidity }),
      operation({ type: "save_financial_year", value: financialYear }),
    ]));
    expect(next.financialYears.at(-1)).toEqual(financialYear);
    expect(next.liquidityBaselines.at(-1)).toEqual(liquidity);
  });

  it("records independent before/after audit snapshots on update", () => {
    const updatedCompany = {
      ...adminBaselineSnapshot.housingCompany,
      name: "Päivitetty taloyhtiö",
    };
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_housing_company", value: updatedCompany }),
    ]));
    const audit = next.auditTrail[0];
    expect(audit?.operation).toBe("update");
    expect(audit?.before).toEqual(adminBaselineSnapshot.housingCompany);
    expect(audit?.after).toEqual(updatedCompany);

    (audit?.after as { name: string }).name = "mutated audit";
    expect(next.housingCompany.name).toBe("Päivitetty taloyhtiö");
  });

  it("rejects duplicate operations for the same entity in one batch", () => {
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_asset", value: newAsset }),
      operation({ type: "save_asset", value: { ...newAsset, name: "Other" } }),
    ]))).toThrowError(/more than once/);
  });

  it("requires named sources and an explanation for every admin operation", () => {
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([{
      type: "save_asset",
      value: newAsset,
      sourceIds: [],
      explanation: "",
    }]))).toThrowError(/requires sourceIds and explanation/);
  });

  it("rejects an event whose evidence or asset is absent from the final batch", () => {
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_building_event", value: newEvent }),
    ]))).toThrowError(DomainValidationError);
  });

  it("rejects invalid annual figures and liquidity inputs", () => {
    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      operation({
        type: "save_financial_year",
        value: {
          year: 2026,
          actualCosts: -1,
          sourceIds: ["financial_statement_2026"],
        },
      }),
    ]))).toThrowError(/Financial year/);

    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      operation({
        type: "save_liquidity_baseline",
        value: {
          id: "bad",
          asOfDate: "not-a-date",
          currentCash: 1,
          trailing12mOperatingCosts: 1,
          currentAnnualRepairCollection: 1,
          sourceIds: ["x"],
        },
      }),
    ]))).toThrowError(/Liquidity baseline/);
  });

  it("uses neutral document_update provenance instead of an AI-specific origin", () => {
    const documentEvent: BuildingEvent = {
      ...newEvent,
      id: "event_document_update",
      origin: "document_update",
      sourceIds: ["annual_report_2026"],
      schedule: newEvent.schedule.map((item) => ({
        ...item,
        id: `doc_${item.id}`,
        costEvidenceId: "estimate_document_update",
      })),
    };
    const documentEvidence: CostEvidence = {
      ...newEvidence,
      id: "estimate_document_update",
      eventId: documentEvent.id,
      sourceId: "annual_report_2026",
    };
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_asset", value: newAsset }),
      operation({ type: "save_cost_evidence", value: documentEvidence }),
      operation({ type: "save_building_event", value: documentEvent }),
    ]));
    expect(next.events.find((item) => item.id === documentEvent.id)?.origin)
      .toBe("document_update");
  });

  it("stores an older price and its explicit 2026 confirmation atomically", () => {
    const evidence: CostEvidence = {
      ...newEvidence,
      id: "estimate_heat_pump_2025_price",
      eventId: "event_heat_pump_2025_price",
      priceLevelYear: 2025,
    };
    const event: BuildingEvent = {
      ...newEvent,
      id: "event_heat_pump_2025_price",
      schedule: newEvent.schedule.map((item) => ({
        ...item,
        id: `old_${item.id}`,
        costEvidenceId: evidence.id,
      })),
    };

    expect(() => applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_asset", value: newAsset }),
      operation({ type: "save_cost_evidence", value: evidence }),
      operation({ type: "save_building_event", value: event }),
    ]))).toThrowError(/price level/);

    const next = applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_price_level_confirmation", value: {
        costEvidenceId: evidence.id,
        targetYear: 2026,
        confirmedAt: NOW,
        confirmedBy: ACTOR,
      } }),
      operation({ type: "save_building_event", value: event }),
      operation({ type: "save_asset", value: newAsset }),
      operation({ type: "save_cost_evidence", value: evidence }),
    ]));
    expect(next.priceLevelConfirmations).toHaveLength(1);
    expect(next.events.some((item) => item.id === event.id)).toBe(true);
  });

  it("commits through a repository with optimistic revision control", async () => {
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
    const saved = await commitAdminBatch(repository, command([
      operation({ type: "save_asset", value: newAsset }),
    ]));
    expect(saved.revision).toBe(1);

    await expect(commitAdminBatch(repository, command([
      operation({ type: "save_asset", value: { ...newAsset, name: "stale" } }),
    ], 0))).rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });
  });

  it("repository loads and returns defensive copies", async () => {
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
    const loaded = await repository.load(adminBaselineSnapshot.companyId);
    expect(loaded).toBeDefined();
    (loaded?.assets as Asset[]).push(newAsset);
    const loadedAgain = await repository.load(adminBaselineSnapshot.companyId);
    expect(loadedAgain?.assets.some((item) => item.id === newAsset.id)).toBe(false);
  });

  it("sorts persisted collections deterministically", () => {
    const assetZ = { ...newAsset, id: "asset_z" };
    const assetA = { ...newAsset, id: "asset_a" };
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_asset", value: assetZ }),
      operation({ type: "save_asset", value: assetA }),
    ]));
    expect(next.assets.map((item) => item.id)).toEqual(
      [...next.assets.map((item) => item.id)].sort(),
    );
  });

  it("feeds persisted admin values into projection and liquidity unchanged", () => {
    const next = applyAdminBatch(adminBaselineSnapshot, command([
      operation({ type: "save_asset", value: newAsset }),
      operation({ type: "save_cost_evidence", value: newEvidence }),
      operation({ type: "save_building_event", value: newEvent }),
    ]));
    const projection = buildProjection({
      assets: next.assets,
      events: next.events,
      costEvidence: next.costEvidence,
      priceLevelConfirmations: next.priceLevelConfirmations,
      horizon: { startYear: 2027, endYear: 2035 },
    });
    expect(projection.scenarios.base.horizonAmount).toBe(12_500);

    const baseline = next.liquidityBaselines[0];
    expect(baseline).toBeDefined();
    const liquidity = buildLiquidityForecast({
      projection,
      currentCash: baseline!.currentCash,
      trailing12mOperatingCosts: baseline!.trailing12mOperatingCosts,
      currentAnnualRepairCollection: baseline!.currentAnnualRepairCollection,
      horizon: { startYear: 2027, endYear: 2035 },
      apartmentCount: next.housingCompany.apartmentCount,
      totalChargeableAreaM2: 1_245,
      operatingBufferSettings: { bufferMonths: 3.5 },
    });
    expect(liquidity.scenarios.base.cashPath.knownRepairCostsTotal).toBe(12_500);
  });

  it("can initialize a manually entered empty company without a database choice", () => {
    const empty = createAdminDataSnapshot({
      housingCompany: {
        id: "new_company",
        name: "Uusi taloyhtiö",
        apartmentCount: 8,
      },
      updatedAt: NOW,
      updatedBy: ACTOR,
    });
    expect(empty.companyId).toBe("new_company");
    expect(empty.events).toEqual([]);
  });
});

describe("delete_entity", () => {
  /** An asset nothing else refers to, so it can be deleted on its own. */
  const loneAsset: Asset = {
    id: "asset_manual_bike_shed",
    name: "Pyörävarasto",
    category: "yard",
    sourceIds: ["manual_admin_entry_2026"],
    active: true,
  };

  /** Baseline + the asset/evidence/event trio, so deletions have something to cascade over. */
  function seeded() {
    return applyAdminBatch(
      adminBaselineSnapshot,
      command([
        operation({ type: "save_asset", value: newAsset }),
        operation({ type: "save_cost_evidence", value: newEvidence }),
        operation({ type: "save_building_event", value: newEvent }),
        operation({ type: "save_asset", value: loneAsset }),
      ]),
    );
  }

  it("removes the entity and records a delete audit entry carrying before but no after", () => {
    const seed = seeded();
    const next = applyAdminBatch(
      seed,
      command(
        [operation({ type: "delete_entity", entityType: "asset", entityKey: loneAsset.id })],
        seed.revision,
      ),
    );

    expect(next.assets.some((item) => item.id === loneAsset.id)).toBe(false);
    const audit = next.auditTrail.at(-1);
    expect(audit?.operation).toBe("delete");
    expect(audit?.entityType).toBe("asset");
    expect(audit?.entityKey).toBe(loneAsset.id);
    expect(audit?.before).toEqual(loneAsset);
    expect(audit?.after).toBeUndefined();
    // The audit trail keeps every earlier entry: deletion removes the entity,
    // not its history.
    expect(next.auditTrail.length).toBe(seed.auditTrail.length + 1);
  });

  it("keeps cost evidence alive when its event is deleted, with eventId cleared in the same batch", () => {
    // The user's call (handoff review): a contractor quote is expensive to
    // obtain and still says what the work costs after the planned event is
    // dropped, and eventId is optional in the model — so the cascade clears
    // the back-reference instead of destroying the evidence.
    const seed = seeded();
    const { eventId: _dropped, ...evidenceWithoutEvent } = newEvidence;
    const next = applyAdminBatch(
      seed,
      command(
        [
          operation({ type: "delete_entity", entityType: "building_event", entityKey: newEvent.id }),
          operation({ type: "save_cost_evidence", value: evidenceWithoutEvent }),
        ],
        seed.revision,
      ),
    );

    expect(next.events.some((item) => item.id === newEvent.id)).toBe(false);
    const evidence = next.costEvidence.find((item) => item.id === newEvidence.id);
    expect(evidence).toBeDefined();
    expect(evidence?.eventId).toBeUndefined();
    expect(evidence?.assetId).toBe(newAsset.id);
    expect(evidence?.amount).toBe(12_500);
  });

  it("rejects the batch when the target no longer exists instead of silently doing nothing", () => {
    const seed = seeded();
    expect(() => applyAdminBatch(
      seed,
      command(
        [operation({
          type: "delete_entity",
          entityType: "asset",
          entityKey: "asset_that_was_never_here",
        })],
        seed.revision,
      ),
    )).toThrowError(/cannot delete missing/);
  });

  it("rejects deleting the housing company", () => {
    expect(() => applyAdminBatch(
      adminBaselineSnapshot,
      command([operation({
        type: "delete_entity",
        // Cast: the union forbids this at compile time, but the HTTP layer
        // forwards operations as opaque JSON, so the runtime guard must hold.
        entityType: "housing_company" as "asset",
        entityKey: adminBaselineSnapshot.companyId,
      })]),
    )).toThrowError(DomainValidationError);
  });

  it("rejects a delete whose entityKey is blank", () => {
    expect(() => applyAdminBatch(
      adminBaselineSnapshot,
      command([operation({ type: "delete_entity", entityType: "asset", entityKey: "  " })]),
    )).toThrowError(DomainValidationError);
  });

  it("rejects a batch that both saves and deletes the same entity", () => {
    const seed = seeded();
    expect(() => applyAdminBatch(
      seed,
      command(
        [
          operation({ type: "save_asset", value: { ...newAsset, name: "Uusi nimi" } }),
          operation({ type: "delete_entity", entityType: "asset", entityKey: newAsset.id }),
        ],
        seed.revision,
      ),
    )).toThrowError(/more than once/);
  });

  it("rejects a partial cascade that would leave a dangling reference", () => {
    // The asset alone: its observation-free event and evidence would be orphaned.
    const seed = seeded();
    expect(() => applyAdminBatch(
      seed,
      command(
        [operation({ type: "delete_entity", entityType: "asset", entityKey: newAsset.id })],
        seed.revision,
      ),
    )).toThrowError(DomainValidationError);
  });

  it("accepts the whole cascade applied as one batch, in any order", () => {
    // Deleting the asset takes its event and its asset-bound evidence with it;
    // order inside the batch does not matter because the snapshot is validated
    // once, after every operation has been staged.
    const seed = seeded();
    const next = applyAdminBatch(
      seed,
      command(
        [
          operation({ type: "delete_entity", entityType: "building_event", entityKey: newEvent.id }),
          operation({ type: "delete_entity", entityType: "cost_evidence", entityKey: newEvidence.id }),
          operation({ type: "delete_entity", entityType: "asset", entityKey: newAsset.id }),
        ],
        seed.revision,
      ),
    );

    expect(next.assets.some((item) => item.id === newAsset.id)).toBe(false);
    expect(next.events.some((item) => item.id === newEvent.id)).toBe(false);
    expect(next.costEvidence.some((item) => item.id === newEvidence.id)).toBe(false);
    expect(next.auditTrail.slice(-3).map((item) => item.operation)).toEqual([
      "delete",
      "delete",
      "delete",
    ]);
  });

  it("deletes a financial entry by its accountCode:year key without touching its sibling years", () => {
    const seed = applyAdminBatch(
      adminBaselineSnapshot,
      command([
        operation({
          type: "save_financial_account",
          value: {
            accountCode: "5300",
            name: "Isännöintipalkkiot",
            kind: "expense",
            group: "Hallintopalvelut",
            active: true,
          },
        }),
        operation({
          type: "save_financial_entry",
          value: { accountCode: "5300", year: 2024, actualAmount: -12_000, sourceIds: ["tp_2024"] },
        }),
        operation({
          type: "save_financial_entry",
          value: { accountCode: "5300", year: 2025, actualAmount: -12_800, sourceIds: ["tp_2025"] },
        }),
      ]),
    );

    const next = applyAdminBatch(
      seed,
      command(
        [operation({
          type: "delete_entity",
          entityType: "financial_entry",
          entityKey: "5300:2025",
        })],
        seed.revision,
      ),
    );

    expect(next.financialEntries.map((item) => item.year)).toEqual([2024]);
    expect(next.financialAccounts.some((item) => item.accountCode === "5300")).toBe(true);
  });
});
