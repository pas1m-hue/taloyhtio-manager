import type {
  FinancialYear,
  HousingCompany,
  LiquidityBaselineRecord,
} from "../domain/types.js";
import { createAdminDataSnapshot } from "../admin/applyAdminBatch.js";
import {
  initialExcelAssets,
  initialExcelCostGaps,
  initialExcelEvents,
} from "./initialExcelDefaults.js";
import { correctedWorkbookLiquidityBaseline } from "./liquidityBaseline.js";

export const adminBaselineCompany: HousingCompany = {
  id: "housing_company_demo",
  name: "Taloyhtiö Manager - lähtöyhtiö",
  apartmentCount: 13,
  chargeableAreaM2: 1_245,
  operatingBuffer: { bufferMonths: 3.5 },
};

export const adminBaselineFinancialYear: FinancialYear = {
  year: 2025,
  actualCosts: 34_029.46,
  sourceIds: ["corrected_workbook_2025"],
  notes: "Fixture contains only the verified operating-cost figure used by V1.9.",
};

export const adminBaselineLiquidity: LiquidityBaselineRecord = {
  id: "liquidity_2025_12_31",
  asOfDate: "2025-12-31",
  currentCash: correctedWorkbookLiquidityBaseline.currentCash,
  trailing12mOperatingCosts:
    correctedWorkbookLiquidityBaseline.trailing12mOperatingCosts,
  currentAnnualRepairCollection:
    correctedWorkbookLiquidityBaseline.currentAnnualRepairCollection,
  sourceIds: [
    correctedWorkbookLiquidityBaseline.sources.currentCash,
    correctedWorkbookLiquidityBaseline.sources.trailing12mOperatingCosts,
    correctedWorkbookLiquidityBaseline.sources.currentAnnualRepairCollection,
  ],
  notes: correctedWorkbookLiquidityBaseline.notes.currentAnnualRepairCollection,
};

export const adminBaselineSnapshot = createAdminDataSnapshot({
  housingCompany: adminBaselineCompany,
  financialYears: [adminBaselineFinancialYear],
  liquidityBaselines: [adminBaselineLiquidity],
  assets: initialExcelAssets,
  costEvidence: initialExcelCostGaps,
  events: initialExcelEvents,
  updatedAt: "2026-07-17T15:00:00+03:00",
  updatedBy: "admin:pasi",
});
