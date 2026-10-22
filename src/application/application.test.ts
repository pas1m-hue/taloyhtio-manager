import { describe, expect, it } from "vitest";
import type {
  AdminDataBatchCommand,
  BuildingEvent,
  CostEvidence,
  Horizon,
} from "../domain/types.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import {
  financialActualsExpected,
  financialActualsFixture,
} from "../fixtures/financialActuals.js";
import { InMemoryAdminDataRepository } from "../admin/adminRepository.js";
import {
  applyAdminChanges,
  loadAdminWorkspace,
  previewAdminCalculations,
} from "./adminApplicationService.js";
const COMPANY_ID = adminBaselineSnapshot.companyId;
const HORIZON: Horizon = { startYear: 2026, endYear: 2057 };

function adminBatch(
  expectedRevision: number,
  operations: AdminDataBatchCommand["operations"],
): AdminDataBatchCommand {
  return {
    companyId: COMPANY_ID,
    expectedRevision,
    actorId: "admin:pasi",
    occurredAt: `2026-07-17T19:${String(expectedRevision + 1).padStart(2, "0")}:00+03:00`,
    operations,
  };
}

function numericEventOperations(
  id = "manual_balcony_repair",
  amount = 12_500,
): AdminDataBatchCommand["operations"] {
  const evidence: CostEvidence = {
    id: `evidence_${id}`,
    assetId: "asset_balcony_soffit_treatment",
    eventId: `event_${id}`,
    status: "estimate",
    amount,
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "manual_budget_estimate_2026",
  };
  const event: BuildingEvent = {
    id: `event_${id}`,
    assetId: "asset_balcony_soffit_treatment",
    title: "Parvekkeiden paikallinen korjaus",
    type: "repair",
    status: "approved",
    origin: "manual",
    sourceIds: ["manual_budget_estimate_2026"],
    schedule: [{
      id: "base_2028",
      scenario: "base",
      year: 2028,
      amount,
      costEvidenceId: evidence.id,
      explanation: "Adminin syöttämä arvio.",
    }],
  };
  return [
    {
      type: "save_cost_evidence",
      value: evidence,
      sourceIds: ["manual_budget_estimate_2026"],
      explanation: "Add reviewed numeric estimate.",
    },
    {
      type: "save_building_event",
      value: event,
      sourceIds: ["manual_budget_estimate_2026"],
      explanation: "Add approved repair event.",
    },
  ];
}

function suggestedOnlyOperations(): AdminDataBatchCommand["operations"] {
  const evidence: CostEvidence = {
    id: "gap_suggested_window_study",
    assetId: "asset_exterior_wall_painting",
    eventId: "event_suggested_window_study",
    status: "data_gap",
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "board_note_2026",
  };
  const event: BuildingEvent = {
    id: "event_suggested_window_study",
    assetId: "asset_exterior_wall_painting",
    title: "Ikkunoiden kuntotutkimusluonnos",
    type: "study",
    status: "suggested",
    origin: "document_update",
    sourceIds: ["board_note_2026"],
    schedule: [{
      id: "base_2029",
      scenario: "base",
      year: 2029,
      costEvidenceId: evidence.id,
      explanation: "Adminin luonnos, ei hyväksytty.",
    }],
  };
  return [
    {
      type: "save_cost_evidence",
      value: evidence,
      sourceIds: ["board_note_2026"],
      explanation: "Store source-backed draft gap.",
    },
    {
      type: "save_building_event",
      value: event,
      sourceIds: ["board_note_2026"],
      explanation: "Store suggested event draft.",
    },
  ];
}

function accountedRepository() {
  // With account data, because the liquidity figures are derived from it: a
  // workspace without it has no forecast at all, which is the subject of its
  // own test below rather than the setup for every other one.
  return new InMemoryAdminDataRepository([{
    ...adminBaselineSnapshot,
    ...financialActualsFixture,
  }]);
}

describe("V2.4 application services and UI read models", () => {
  it("loads the admin workspace without exposing repository details", async () => {
    const repository = new InMemoryAdminDataRepository([adminBaselineSnapshot]);
    const dashboard = await loadAdminWorkspace(repository, COMPANY_ID, HORIZON);
    expect(dashboard.adminRevision).toBe(0);
    expect(dashboard).not.toHaveProperty("publication");
    expect(dashboard.calculations.projection.scenarios.base.dataGaps.withinHorizon.length)
      .toBeGreaterThan(0);
    // The baseline fixture carries no account data, and both liquidity inputs
    // are now derived from account data rather than hand-entered. A company
    // that has not imported its accounts therefore has no forecast, and is
    // told which figures are missing - the DATA GAP rule reaching the
    // liquidity model. The previous assertion here read "available", on the
    // strength of two stored numbers that nothing kept current.
    expect(dashboard.calculations.liquidity).toEqual({
      status: "unavailable",
      missingFields: ["trailing12mOperatingCosts", "operatingMargin"],
    });
    expect(dashboard.calculations.operatingFigures.costs)
      .toEqual({ status: "unavailable", reason: "no_expense_actuals" });
  });

  it("computes both liquidity inputs once the accounts are imported", async () => {
    const repository = new InMemoryAdminDataRepository([{
      ...adminBaselineSnapshot,
      ...financialActualsFixture,
    }]);

    const dashboard = await loadAdminWorkspace(repository, COMPANY_ID, HORIZON);

    const { operatingFigures, liquidity } = dashboard.calculations;
    if (operatingFigures.costs.status !== "available" ||
        operatingFigures.margin.status !== "available") {
      throw new Error("fixture must produce both figures");
    }
    expect(operatingFigures.costs.trailing12mOperatingCosts)
      .toBe(financialActualsExpected.trailing12mOperatingCosts);
    expect(operatingFigures.margin.operatingMargin)
      .toBe(financialActualsExpected.operatingMargin);

    if (liquidity.status !== "available") throw new Error("expected a forecast");
    // The forecast reads the computed figures, not the baseline's stored
    // 34 029,46 and 9 680 - which is the entire point of the change.
    expect(liquidity.forecast.scenarios.base.cashPath.annualOperatingMargin)
      .toBe(financialActualsExpected.operatingMargin);
    // The buffer target is the computed divisor spread over its months, so
    // asserting it is asserting that the divisor reached the buffer at all.
    const { bufferMonths, suggestedOperatingBuffer } = liquidity.forecast.operatingBuffer;
    expect(suggestedOperatingBuffer).toBeCloseTo(
      financialActualsExpected.trailing12mOperatingCosts / 12 * bufferMonths,
      2,
    );
  });

  it("applies one admin batch and returns a refreshed calculated dashboard", async () => {
    const repository = accountedRepository();
    const dashboard = await applyAdminChanges(
      repository,
      adminBatch(0, numericEventOperations()),
      HORIZON,
    );
    expect(dashboard.adminRevision).toBe(1);
    expect(dashboard.auditTrail).toHaveLength(2);
    expect(dashboard.calculations.projection.scenarios.base.horizonAmount).toBe(12_500);
  });

  it("counts a suggested event without putting it in the projection", async () => {
    const repository = accountedRepository();
    const dashboard = await applyAdminChanges(
      repository,
      adminBatch(0, suggestedOnlyOperations()),
      HORIZON,
    );
    expect(dashboard.counts.suggestedEvents).toBe(1);
    expect(dashboard.calculations.projection.scenarios.base.horizonAmount).toBe(0);
    expect(dashboard.calculations.projection.suggestions).toHaveLength(1);
  });

  it("returns the same deterministic calculation preview as the full dashboard", async () => {
    const repository = accountedRepository();
    await applyAdminChanges(repository, adminBatch(0, numericEventOperations()), HORIZON);
    const preview = await previewAdminCalculations(repository, COMPANY_ID, HORIZON);
    const dashboard = await loadAdminWorkspace(repository, COMPANY_ID, HORIZON);
    expect(preview).toEqual(dashboard.calculations);
  });

  it("fails loudly when the admin workspace does not exist", async () => {
    const repository = new InMemoryAdminDataRepository();
    await expect(loadAdminWorkspace(repository, "missing", HORIZON))
      .rejects.toMatchObject({ code: "ADMIN_DATA_NOT_FOUND" });
    await expect(previewAdminCalculations(repository, "missing", HORIZON))
      .rejects.toMatchObject({ code: "ADMIN_DATA_NOT_FOUND" });
  });

  it("propagates a stale admin revision as an explicit conflict", async () => {
    const adminData = accountedRepository();
    await applyAdminChanges(adminData, adminBatch(0, numericEventOperations()), HORIZON);
    await expect(applyAdminChanges(
      adminData,
      adminBatch(0, numericEventOperations("another_event")),
      HORIZON,
    )).rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });
  });

  it("does not let read-model mutation alter stored admin state", async () => {
    const adminData = accountedRepository();
    const admin = await loadAdminWorkspace(adminData, COMPANY_ID, HORIZON);
    ((admin.assets as unknown) as { name: string }[])[0]!.name = "mutated";

    expect((await loadAdminWorkspace(adminData, COMPANY_ID, HORIZON)).assets[0]!.name)
      .not.toBe("mutated");
  });
});
