import type {
  AuthorizedPublishAdminDataCommand,
  VerifiedIdentity,
} from "../auth/authTypes.js";
import type { CompanyAccessRepository } from "../auth/companyAccessRepository.js";
import { requireCompanyAdmin } from "../auth/authorization.js";
import type { PublishingRepository } from "../publishing/publicationRepository.js";
import type {
  PublicationHistoryItem,
  PublicationHistoryReadModel,
} from "../readModels/publishedOverview.js";
import {
  loadPublicationHistory,
  publishAdminRevision,
} from "./publishingApplicationService.js";

export async function publishAuthorizedAdminRevision(
  repository: PublishingRepository,
  access: CompanyAccessRepository,
  identity: VerifiedIdentity | undefined,
  command: AuthorizedPublishAdminDataCommand,
  asOf: string,
): Promise<PublicationHistoryItem> {
  const actor = await requireCompanyAdmin(
    access,
    identity,
    command.companyId,
    asOf,
  );
  return publishAdminRevision(repository, {
    ...command,
    publishedBy: actor.subjectId,
    publishedAt: asOf,
  });
}

export async function loadAuthorizedPublicationHistory(
  repository: PublishingRepository,
  access: CompanyAccessRepository,
  identity: VerifiedIdentity | undefined,
  companyId: string,
  asOf: string,
): Promise<PublicationHistoryReadModel> {
  await requireCompanyAdmin(access, identity, companyId, asOf);
  return loadPublicationHistory(repository, companyId);
}
