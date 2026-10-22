import type {
  AdminAuditEntry,
  AdminDataSnapshot,
  BuildingEvent,
  Horizon,
} from "../domain/types.js";
import {
  buildSnapshotCalculations,
  latestLiquidityBaseline,
  type SnapshotCalculationReadModel,
} from "./calculationReadModel.js";
import { buildCashPathTable, type CashPathTableReadModel } from "./cashPathTable.js";

export interface AdminDashboardCounts {
  readonly assets: number;
  readonly approvedEvents: number;
  readonly suggestedEvents: number;
  readonly actualEvents: number;
  readonly cancelledEvents: number;
  readonly dataGapsWithinHorizon: number;
}

export interface AdminDashboardReadModel {
  readonly companyId: string;
  readonly adminRevision: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly housingCompany: AdminDataSnapshot["housingCompany"];
  readonly financialYears: AdminDataSnapshot["financialYears"];
  readonly latestLiquidityBaseline?: AdminDataSnapshot["liquidityBaselines"][number];
  readonly assets: AdminDataSnapshot["assets"];
  readonly observations: AdminDataSnapshot["observations"];
  readonly costEvidence: AdminDataSnapshot["costEvidence"];
  readonly priceLevelConfirmations: AdminDataSnapshot["priceLevelConfirmations"];
  readonly events: AdminDataSnapshot["events"];
  readonly financialAccounts: AdminDataSnapshot["financialAccounts"];
  readonly financialEntries: AdminDataSnapshot["financialEntries"];
  readonly balanceSheetSnapshots: AdminDataSnapshot["balanceSheetSnapshots"];
  readonly groupBudgets: AdminDataSnapshot["groupBudgets"];
  readonly groupActuals: AdminDataSnapshot["groupActuals"];
  readonly maintenanceDocuments: AdminDataSnapshot["maintenanceDocuments"];
  readonly auditTrail: readonly AdminAuditEntry[];
  readonly counts: AdminDashboardCounts;
  readonly calculations: SnapshotCalculationReadModel;
  /** Reads balance sheets and budgets as well as the account data. */
  readonly cashPathTable: CashPathTableReadModel;
}

export function buildAdminDashboardReadModel(
  admin: AdminDataSnapshot,
  horizon: Horizon,
): AdminDashboardReadModel {
  const calculations = buildSnapshotCalculations(admin, horizon);
  const latestBaseline = latestLiquidityBaseline(admin.liquidityBaselines);
  const counts = eventCounts(admin.assets.length, admin.events, calculations);
  return structuredClone({
    companyId: admin.companyId,
    adminRevision: admin.revision,
    updatedAt: admin.updatedAt,
    updatedBy: admin.updatedBy,
    housingCompany: admin.housingCompany,
    financialYears: admin.financialYears,
    ...(latestBaseline === undefined ? {} : { latestLiquidityBaseline: latestBaseline }),
    assets: admin.assets,
    observations: admin.observations,
    costEvidence: admin.costEvidence,
    priceLevelConfirmations: admin.priceLevelConfirmations,
    events: admin.events,
    financialAccounts: admin.financialAccounts,
    financialEntries: admin.financialEntries,
    balanceSheetSnapshots: admin.balanceSheetSnapshots,
    groupBudgets: admin.groupBudgets,
    groupActuals: admin.groupActuals,
    maintenanceDocuments: admin.maintenanceDocuments,
    auditTrail: admin.auditTrail,
    counts,
    calculations,
    cashPathTable: buildCashPathTable(admin),
  });
}

function eventCounts(
  assetCount: number,
  events: readonly BuildingEvent[],
  calculations: SnapshotCalculationReadModel,
): AdminDashboardCounts {
  return {
    assets: assetCount,
    approvedEvents: events.filter((event) => event.status === "approved").length,
    suggestedEvents: events.filter((event) => event.status === "suggested").length,
    actualEvents: events.filter((event) => event.status === "actual").length,
    cancelledEvents: events.filter((event) => event.status === "cancelled").length,
    dataGapsWithinHorizon: calculations.projection.dataGaps.filter(
      (gap) => gap.horizonPosition === "within",
    ).length,
  };
}
