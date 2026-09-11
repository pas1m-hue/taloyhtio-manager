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
import { fingerprintAdminPublishableContent } from "../publishing/publishedSnapshot.js";

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

    const model = buildAdminDashboardReadModel(admin, undefined, HORIZON);

    expect(model.observations).toEqual([observation]);
    expect(model.costEvidence).toEqual([dataGapEvidence]);
    expect(model.priceLevelConfirmations).toEqual([priceLevelConfirmation]);
    expect(model.financialAccounts).toEqual([financialAccount]);
    expect(model.financialEntries).toEqual([financialEntry]);
  });

  it("returns deep clones, not references into the snapshot", () => {
    const admin = snapshotWithMaintenanceData();

    const model = buildAdminDashboardReadModel(admin, undefined, HORIZON);

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

    const model = buildAdminDashboardReadModel(admin, undefined, HORIZON);

    expect(model.observations).toEqual([]);
    expect(model.costEvidence).toEqual([]);
    expect(model.priceLevelConfirmations).toEqual([]);
    expect(model.financialAccounts).toEqual([]);
    expect(model.financialEntries).toEqual([]);
  });
});

describe("group-level actuals reach both the admin UI and the publication", () => {
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

    const model = buildAdminDashboardReadModel(admin, undefined, HORIZON);

    expect(model.groupActuals).toEqual([groupActual]);
    expect(model.groupActuals).not.toBe(admin.groupActuals);
  });

  it("changes the publishable fingerprint, because the forecast now reads it", () => {
    // This assertion is the inverse of the one it replaces, and deliberately
    // so. When group actuals were admin-only display data, importing one had
    // to leave the publication alone. The published liquidity model now
    // computes hoitokate and the buffer divisor from account data, and a
    // group-level actual overrides the account sum it uses — so a publication
    // made before the import and one made after genuinely differ, and a
    // fingerprint that hid that would let a visitor session stay pinned to a
    // publication whose numbers had moved underneath it.
    const base = snapshotWithMaintenanceData();
    const withGroupActual = createAdminDataSnapshot({ ...base, groupActuals: [groupActual] });

    expect(fingerprintAdminPublishableContent(withGroupActual))
      .not.toBe(fingerprintAdminPublishableContent(base));
  });

  it("still leaves a group budget out of the publication entirely", () => {
    // What did not change: budgets feed no published calculation, so they stay
    // admin-only and must not make the workspace look unpublished. Keeping
    // this beside the assertion above is the point — "publish the account data"
    // means the minimum the forecast reads, not the finance model wholesale.
    const base = snapshotWithMaintenanceData();
    const withGroupBudget = createAdminDataSnapshot({
      ...base,
      groupBudgets: [{
        id: "gb_income_hoitovastikkeet_2026",
        group: "Hoitovastikkeet",
        kind: "income" as const,
        year: 2026,
        budgetAmount: 44_000,
        active: true,
        sourceIds: ["talousarvio_2026"],
      }],
    });

    expect(fingerprintAdminPublishableContent(withGroupBudget))
      .toBe(fingerprintAdminPublishableContent(base));
  });
});

describe("the cash path table is admin-only (feature/cashpath-rebuild)", () => {
  it("reaches the admin UI through the dashboard read model", () => {
    const model = buildAdminDashboardReadModel(snapshotWithMaintenanceData(), undefined, HORIZON);

    expect(model.cashPathTable.scenarios.base.rows).toEqual([]);
    expect(model.cashPathTable.completedRepairs).toEqual([]);
    // The forecast the visitor cards and Vastiketarve read is still there,
    // untouched, beside it.
    expect(model.calculations.liquidity.status).toBe("unavailable");
  });

  it("does not reach the publication: balance sheets stay out of the fingerprint", () => {
    // The table reads balance sheets and budgets. Neither feeds a published
    // calculation, so adding a balance sheet must not make the workspace
    // look unpublished - the same rule the group budget follows above.
    const base = snapshotWithMaintenanceData();
    const withBalanceSheet = createAdminDataSnapshot({
      ...base,
      balanceSheetSnapshots: [{
        id: "tase_2025",
        asOfDate: "2025-12-31",
        sourceIds: ["tilinpaatos_2025"],
        entries: [{ section: "current_assets" as const, key: "rahat", name: "Rahat ja pankkisaamiset", amount: 22_208 }],
      }],
    });

    expect(fingerprintAdminPublishableContent(withBalanceSheet))
      .toBe(fingerprintAdminPublishableContent(base));
    expect(buildAdminDashboardReadModel(withBalanceSheet, undefined, HORIZON).cashPathTable)
      .toEqual(buildAdminDashboardReadModel(base, undefined, HORIZON).cashPathTable);
  });
});
