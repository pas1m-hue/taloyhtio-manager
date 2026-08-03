import { describe, expect, it } from "vitest";
import type {
  CostEvidence,
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
  });

  it("returns deep clones, not references into the snapshot", () => {
    const admin = snapshotWithMaintenanceData();

    const model = buildAdminDashboardReadModel(admin, undefined, HORIZON);

    expect(model.observations).not.toBe(admin.observations);
    expect(model.costEvidence).not.toBe(admin.costEvidence);
    expect(model.priceLevelConfirmations).not.toBe(admin.priceLevelConfirmations);
    expect(model.observations[0]).not.toBe(admin.observations[0]);
    expect(model.costEvidence[0]).not.toBe(admin.costEvidence[0]);
    expect(model.priceLevelConfirmations[0]).not.toBe(admin.priceLevelConfirmations[0]);
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
  });
});
