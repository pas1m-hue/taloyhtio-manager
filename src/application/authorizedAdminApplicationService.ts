import type { Horizon } from "../domain/types.js";
import type {
  AuthorizedAdminDataBatchCommand,
  VerifiedIdentity,
} from "../auth/authTypes.js";
import type { CompanyAccessRepository } from "../auth/companyAccessRepository.js";
import { requireCompanyAdmin } from "../auth/authorization.js";
import type { PublishingRepository } from "../publishing/publicationRepository.js";
import type { AdminDashboardReadModel } from "../readModels/adminDashboard.js";
import type { SnapshotCalculationReadModel } from "../readModels/calculationReadModel.js";
import {
  applyAdminChanges,
  loadAdminWorkspace,
  previewAdminCalculations,
} from "./adminApplicationService.js";

export async function loadAuthorizedAdminWorkspace(
  repository: PublishingRepository,
  access: CompanyAccessRepository,
  identity: VerifiedIdentity | undefined,
  companyId: string,
  horizon: Horizon,
  asOf: string,
): Promise<AdminDashboardReadModel> {
  await requireCompanyAdmin(access, identity, companyId, asOf);
  return loadAdminWorkspace(repository, companyId, horizon);
}

export async function applyAuthorizedAdminChanges(
  repository: PublishingRepository,
  access: CompanyAccessRepository,
  identity: VerifiedIdentity | undefined,
  command: AuthorizedAdminDataBatchCommand,
  horizon: Horizon,
  asOf: string,
): Promise<AdminDashboardReadModel> {
  const actor = await requireCompanyAdmin(
    access,
    identity,
    command.companyId,
    asOf,
  );
  return applyAdminChanges(repository, {
    ...command,
    actorId: actor.subjectId,
    occurredAt: asOf,
  }, horizon);
}

export async function previewAuthorizedAdminCalculations(
  repository: PublishingRepository,
  access: CompanyAccessRepository,
  identity: VerifiedIdentity | undefined,
  companyId: string,
  horizon: Horizon,
  asOf: string,
): Promise<SnapshotCalculationReadModel> {
  await requireCompanyAdmin(access, identity, companyId, asOf);
  return previewAdminCalculations(repository, companyId, horizon);
}
