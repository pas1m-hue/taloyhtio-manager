import { describe, expect, it } from "vitest";
import { createAdminDataSnapshot } from "../src/admin/applyAdminBatch.js";
import { applyAdminBatch } from "../src/admin/applyAdminBatch.js";
import type { AdminDataSnapshot, CostEvidence } from "../src/domain/types.js";
import {
  TRAILING_12M_OPERATING_COSTS_PLACEHOLDER,
  TrailingCostsDataGapError,
  VENTILATION_CLEANING_COST_EVIDENCE_ID,
  WATER_HEATER_ASSET_ID,
  buildSeedOperations,
  resolveTrailingCosts,
  shouldRunSeed,
} from "./seedOperations.js";

const CONFIRMED_TRAILING_COSTS = resolveTrailingCosts({
  TM_TRAILING_12M_OPERATING_COSTS: "36000",
});

describe("resolveTrailingCosts", () => {
  it("throws a DATA GAP error when no value or placeholder opt-in is given", () => {
    expect(() => resolveTrailingCosts({})).toThrow(TrailingCostsDataGapError);
  });

  it("throws on a non-numeric confirmed value", () => {
    expect(() =>
      resolveTrailingCosts({ TM_TRAILING_12M_OPERATING_COSTS: "not-a-number" }),
    ).toThrow(TrailingCostsDataGapError);
  });

  it("uses the confirmed env value when provided", () => {
    const result = resolveTrailingCosts({ TM_TRAILING_12M_OPERATING_COSTS: "36000" });
    expect(result.value).toBe(36_000);
    expect(result.isPlaceholder).toBe(false);
  });

  it("uses the named placeholder only with explicit opt-in", () => {
    const result = resolveTrailingCosts({ TM_ALLOW_PLACEHOLDER: "1" });
    expect(result.value).toBe(TRAILING_12M_OPERATING_COSTS_PLACEHOLDER);
    expect(result.isPlaceholder).toBe(true);
    expect(result.notes).toContain("PAIKKAMERKKI");
  });
});

describe("buildSeedOperations", () => {
  const { operations, summary } = buildSeedOperations(CONFIRMED_TRAILING_COSTS);

  it("produces exactly six operations", () => {
    expect(operations).toHaveLength(6);
  });

  it("orders assets before the cost evidence and events that reference them", () => {
    const types = operations.map((op) => op.type);
    expect(types).toEqual([
      "save_asset",
      "save_asset",
      "save_cost_evidence",
      "save_cost_evidence",
      "save_building_event",
      "save_liquidity_baseline",
    ]);
  });

  it("produces the correct schedule row and quantity counts per scenario", () => {
    expect(summary.scheduleRowCount).toBe(19);
    expect(summary.scheduleQuantityByScenario).toEqual({
      optimistic: 5,
      base: 12,
      stress: 12,
    });
  });

  it("sets each schedule row's amount to quantity x unit price (1800)", () => {
    const eventOp = operations.find((op) => op.type === "save_building_event");
    if (eventOp?.type !== "save_building_event" || eventOp.value.status !== "suggested") {
      throw new Error("expected the suggested water-heater event");
    }
    for (const entry of eventOp.value.schedule) {
      expect(entry.amount).toBe((entry.quantity ?? 0) * 1_800);
    }
  });

  it("gives the data_gap cost evidence no amount field", () => {
    const costOp = operations.find(
      (op) => op.type === "save_cost_evidence" &&
        op.value.id === VENTILATION_CLEANING_COST_EVIDENCE_ID,
    );
    if (costOp?.type !== "save_cost_evidence") {
      throw new Error("expected the ventilation-cleaning cost evidence");
    }
    const value = costOp.value as CostEvidence;
    expect(value.status).toBe("data_gap");
    expect(value.amount).toBeUndefined();
  });

  it("marks the placeholder trailing-cost figure on the summary", () => {
    const placeholderRun = buildSeedOperations(
      resolveTrailingCosts({ TM_ALLOW_PLACEHOLDER: "1" }),
    );
    expect(placeholderRun.summary.trailingCostsIsPlaceholder).toBe(true);
    expect(summary.trailingCostsIsPlaceholder).toBe(false);
  });

  it("validates cleanly through applyAdminBatch against an empty demo snapshot", () => {
    const empty: AdminDataSnapshot = createAdminDataSnapshot({
      housingCompany: {
        id: "housing_company_demo",
        name: "Taloyhtiö Manager - demo",
        apartmentCount: 13,
      },
      updatedAt: "2026-08-11T00:00:00.000Z",
      updatedBy: "seed_test",
    });

    const next = applyAdminBatch(empty, {
      companyId: "housing_company_demo",
      expectedRevision: 0,
      actorId: "admin:seed",
      occurredAt: "2026-08-11T00:00:00.000Z",
      operations,
    });

    expect(next.revision).toBe(1);
    expect(next.assets.map((a) => a.id).sort()).toEqual(
      [...summary.assetIds].sort(),
    );
    expect(next.events).toHaveLength(1);
  });
});

describe("shouldRunSeed", () => {
  it("returns true when the water-heater asset is not yet present", () => {
    expect(shouldRunSeed({ assets: [] })).toBe(true);
  });

  it("returns false when the water-heater asset already exists", () => {
    expect(shouldRunSeed({ assets: [{ id: WATER_HEATER_ASSET_ID }] })).toBe(false);
  });
});
