import {
  DomainValidationError,
  type AdminDataBatchCommand,
  type Horizon,
} from "../domain/types.js";
import { commitAdminBatch } from "../admin/adminEntryService.js";
import type { AdminDataRepository } from "../admin/adminRepository.js";
import {
  buildAdminDashboardReadModel,
  type AdminDashboardReadModel,
} from "../readModels/adminDashboard.js";
import {
  buildSnapshotCalculations,
  type SnapshotCalculationReadModel,
} from "../readModels/calculationReadModel.js";

/** UI-facing admin workspace. Repository and calculation internals stay hidden. */
export async function loadAdminWorkspace(
  repository: AdminDataRepository,
  companyId: string,
  horizon: Horizon,
): Promise<AdminDashboardReadModel> {
  const admin = await repository.load(companyId);
  if (admin === undefined) {
    throw new DomainValidationError(
      "ADMIN_DATA_NOT_FOUND",
      `Admin data ${companyId} does not exist.`,
    );
  }
  return buildAdminDashboardReadModel(admin, horizon);
}

/** Commits one atomic admin batch and returns a refreshed UI read model. */
export async function applyAdminChanges(
  repository: AdminDataRepository,
  command: AdminDataBatchCommand,
  horizon: Horizon,
): Promise<AdminDashboardReadModel> {
  const admin = await commitAdminBatch(repository, command);
  return buildAdminDashboardReadModel(admin, horizon);
}

/** Calculation-only preview for a UI that does not need the full workspace. */
export async function previewAdminCalculations(
  repository: AdminDataRepository,
  companyId: string,
  horizon: Horizon,
): Promise<SnapshotCalculationReadModel> {
  const admin = await repository.load(companyId);
  if (admin === undefined) {
    throw new DomainValidationError(
      "ADMIN_DATA_NOT_FOUND",
      `Admin data ${companyId} does not exist.`,
    );
  }
  return buildSnapshotCalculations(admin, horizon);
}
