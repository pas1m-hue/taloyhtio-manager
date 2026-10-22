import { describe, expect, it } from "vitest";
import type {
  CostEvidence,
  FinancialAccount,
  FinancialEntry,
  Horizon,
  Observation,
  PriceLevelConfirmation,
} from "../domain/types.js";
import { createAdminDataSnapshot } from "../admin/applyAdminBatch.js";
import { buildAdminDashboardReadModel } from "./adminDashboard.js";

const HORIZON: Horizon = { startYear: 2026, endYear: 2057 };

const observation: Observation = {
  id: "obs_roof_1",
  assetId: "asset_roof",
  observedAt: "2026-03-01",
  description: "Katteessa havaittu kulumaa räystäällä.",
  sourceIds: ["inspection_2026"],
};

const dataGapEvidence: CostEvidence = {
  id: "gap_roof",
  assetId: "asset_roof",
  status: "data_gap",
  unit: "erä",
  priceLevelYear: 2026,
  sourceId: "inspection_2026",
};

const priceLevelConfirmation: PriceLevelConfirmation = {
  costEvidenceId: "gap_roof",
  targetYear: 2026,
  confirmedAt: "2026-03-02",
  confirmedBy: "admin:test",
};

const financialAccount: FinancialAccount = {
  accountCode: "5300",
  name: "Isännöintipalkkiot",
  kind: "expense",
  group: "HALLINTOPALVELUT",
  active: true,
};

const financialEntry: FinancialEntry = {
  accountCode: "5300",
  year: 2025,
  actualAmount: 12000,
  sourceIds: ["initial_excel"],
};

function snapshotWithMaintenanceData() {
  return createAdminDataSnapshot({
    housingCompany: {
      id: "housing_company_demo",
      name: "Testiyhtiö",
      apartmentCount: 12,
    },
    assets: [
      {
        id: "asset_roof",
        name: "Vesikatto",
        category: "envelope",
        sourceIds: ["initial_excel"],
        active: true,
      },
    ],
    observations: [observation],
    costEvidence: [dataGapEvidence],
    priceLevelConfirmations: [priceLevelConfirmation],
    financialAccounts: [financialAccount],
    financialEntries: [financialEntry],
    updatedAt: "2026-07-17T15:00:00+03:00",
    updatedBy: "admin:test",
  });
}

describe("buildAdminDashboardReadModel additive maintenance fields", () => {
  it("exposes observations and costEvidence from the snapshot", () => {
    const admin = snapshotWithMaintenanceData();

    const model = buildAdminDashboardReadModel(admin, HORIZON);

    expect(model.observations).toEqual([observation]);
    expect(model.costEvidence).toEqual([dataGapEvidence]);
    expect(model.priceLevelConfirmations).toEqual([priceLevelConfirmation]);
    expect(model.financialAccounts).toEqual([financialAccount]);
    expect(model.financialEntries).toEqual([financialEntry]);
  });

  it("returns deep clones, not references into the snapshot", () => {
    const admin = snapshotWithMaintenanceData();

    const model = buildAdminDashboardReadModel(admin, HORIZON);

    expect(model.observations).not.toBe(admin.observations);
    expect(model.costEvidence).not.toBe(admin.costEvidence);
    expect(model.priceLevelConfirmations).not.toBe(admin.priceLevelConfirmations);
    expect(model.financialAccounts).not.toBe(admin.financialAccounts);
    expect(model.financialEntries).not.toBe(admin.financialEntries);
    expect(model.observations[0]).not.toBe(admin.observations[0]);
    expect(model.costEvidence[0]).not.toBe(admin.costEvidence[0]);
    expect(model.priceLevelConfirmations[0]).not.toBe(admin.priceLevelConfirmations[0]);
    expect(model.financialAccounts[0]).not.toBe(admin.financialAccounts[0]);
    expect(model.financialEntries[0]).not.toBe(admin.financialEntries[0]);
  });

  it("keeps empty maintenance collections as empty arrays", () => {
    const admin = createAdminDataSnapshot({
      housingCompany: {
        id: "housing_company_demo",
        name: "Testiyhtiö",
        apartmentCount: 12,
      },
      updatedAt: "2026-07-17T15:00:00+03:00",
      updatedBy: "admin:test",
    });

    const model = buildAdminDashboardReadModel(admin, HORIZON);

    expect(model.observations).toEqual([]);
    expect(model.costEvidence).toEqual([]);
    expect(model.priceLevelConfirmations).toEqual([]);
    expect(model.financialAccounts).toEqual([]);
    expect(model.financialEntries).toEqual([]);
  });
});

describe("group-level actuals reach the admin UI", () => {
  const groupActual = {
    id: "income::Hoitovastikkeet::2023",
    group: "Hoitovastikkeet",
    kind: "income" as const,
    year: 2023,
    actualAmount: 36_237.38,
    active: true,
    sourceIds: ["tilinpaatos_2024"],
  };

  it("reaches the admin UI through the dashboard read model", () => {
    // Without this the finance views read state.admin.groupActuals as
    // undefined and every group-level figure silently stops applying.
    const admin = createAdminDataSnapshot({
      ...snapshotWithMaintenanceData(),
      groupActuals: [groupActual],
    });

    const model = buildAdminDashboardReadModel(admin, HORIZON);

    expect(model.groupActuals).toEqual([groupActual]);
    expect(model.groupActuals).not.toBe(admin.groupActuals);
  });

});

describe("the cash path table (feature/cashpath-rebuild)", () => {
  it("reaches the admin UI through the dashboard read model", () => {
    const model = buildAdminDashboardReadModel(snapshotWithMaintenanceData(), HORIZON);

    expect(model.cashPathTable.scenarios.base.rows).toEqual([]);
    expect(model.cashPathTable.completedRepairs).toEqual([]);
    // The forecast Vastiketarve reads is still there, untouched, beside it.
    expect(model.calculations.liquidity.status).toBe("unavailable");
  });
});
