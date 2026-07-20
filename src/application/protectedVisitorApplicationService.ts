import {
  DomainValidationError,
  type VisitorSessionBatchCommand,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import type {
  ProtectedCreateVisitorSessionCommand,
  ProtectedResetVisitorSessionCommand,
  ProtectedVisitorSessionBatchCommand,
  ProtectedVisitorSessionHandle,
  VisitorSessionAccessRecord,
  VisitorSessionCredential,
} from "../auth/authTypes.js";
import type { ProtectedSessionWorkspaceRepository } from "../auth/protectedSessionRepository.js";
import {
  hashVisitorAccessToken,
  SecureSessionCredentialGenerator,
  type SessionCredentialGenerator,
} from "../auth/sessionCredential.js";
import type { PublicationRepository } from "../publishing/publicationRepository.js";
import { createVisitorSessionWorkspace } from "../session/sessionWorkspace.js";
import { applyVisitorSessionBatch } from "../session/sessionWorkspace.js";
import { buildVisitorSessionModelFromState } from "../session/buildVisitorSessionModel.js";
import {
  buildVisitorScenarioViewReadModel,
  type VisitorScenarioViewReadModel,
} from "../readModels/visitorScenarioView.js";

export async function createProtectedVisitorSession(
  publications: PublicationRepository,
  sessions: ProtectedSessionWorkspaceRepository,
  command: ProtectedCreateVisitorSessionCommand,
  generator: SessionCredentialGenerator = new SecureSessionCredentialGenerator(),
): Promise<ProtectedVisitorSessionHandle<VisitorScenarioViewReadModel>> {
  const publication = await publications.loadVersion(
    command.companyId,
    command.publicationVersion,
  );
  if (publication === undefined) {
    throw new DomainValidationError(
      "PUBLISHED_DATA_NOT_FOUND",
      `Published data ${command.companyId} version ` +
        `${command.publicationVersion} does not exist.`,
    );
  }
  const credential = generator.create();
  const workspace = createVisitorSessionWorkspace(publication, {
    ...command,
    sessionId: credential.sessionId,
  });
  const access: VisitorSessionAccessRecord = {
    sessionId: credential.sessionId,
    tokenHash: hashVisitorAccessToken(credential.accessToken),
    createdAt: command.createdAt,
    expiresAt: command.expiresAt,
  };
  await sessions.createProtected(workspace, access);
  return {
    credential: structuredClone(credential),
    view: buildView(publication, workspace),
  };
}

export async function loadProtectedVisitorScenario(
  publications: PublicationRepository,
  sessions: ProtectedSessionWorkspaceRepository,
  credential: VisitorSessionCredential,
  asOf: string,
): Promise<VisitorScenarioViewReadModel> {
  const workspace = await requireProtectedWorkspace(
    sessions,
    credential,
    asOf,
  );
  const publication = await publications.loadVersion(
    workspace.companyId,
    workspace.publicationVersion,
  );
  if (publication === undefined) {
    throw new DomainValidationError(
      "PUBLISHED_DATA_NOT_FOUND",
      `Published data ${workspace.companyId} version ` +
        `${workspace.publicationVersion} does not exist.`,
    );
  }
  return buildView(publication, workspace);
}

export async function applyProtectedVisitorSessionChanges(
  publications: PublicationRepository,
  sessions: ProtectedSessionWorkspaceRepository,
  command: ProtectedVisitorSessionBatchCommand,
  asOf: string,
): Promise<VisitorScenarioViewReadModel> {
  const tokenHash = hashVisitorAccessToken(command.accessToken);
  const current = await requireProtectedWorkspace(
    sessions,
    command,
    asOf,
  );
  const batch: VisitorSessionBatchCommand = {
    sessionId: command.sessionId,
    expectedRevision: command.expectedRevision,
    occurredAt: asOf,
    operations: command.operations,
  };
  const next = applyVisitorSessionBatch(current, batch);
  const saved = await sessions.saveProtected(
    command.sessionId,
    tokenHash,
    asOf,
    command.expectedRevision,
    next,
  );
  const publication = await publications.loadVersion(
    saved.companyId,
    saved.publicationVersion,
  );
  if (publication === undefined) {
    throw new DomainValidationError(
      "PUBLISHED_DATA_NOT_FOUND",
      `Published data ${saved.companyId} version ` +
        `${saved.publicationVersion} does not exist.`,
    );
  }
  return buildView(publication, saved);
}

export async function resetProtectedVisitorSession(
  publications: PublicationRepository,
  sessions: ProtectedSessionWorkspaceRepository,
  command: ProtectedResetVisitorSessionCommand,
  asOf: string,
): Promise<VisitorScenarioViewReadModel> {
  return applyProtectedVisitorSessionChanges(publications, sessions, {
    ...command,
    operations: [{ type: "reset_workspace" }],
  }, asOf);
}

export async function revokeProtectedVisitorSession(
  sessions: ProtectedSessionWorkspaceRepository,
  credential: VisitorSessionCredential,
  revokedAt: string,
): Promise<void> {
  await requireProtectedWorkspace(sessions, credential, revokedAt);
  await sessions.revokeAccess(credential.sessionId, revokedAt);
}

async function requireProtectedWorkspace(
  sessions: ProtectedSessionWorkspaceRepository,
  credential: VisitorSessionCredential,
  asOf: string,
): Promise<VisitorSessionWorkspace> {
  const tokenHash = hashVisitorAccessToken(credential.accessToken);
  const workspace = await sessions.loadProtected(
    credential.sessionId,
    tokenHash,
    asOf,
  );
  if (workspace === undefined) {
    throw new DomainValidationError(
      "INVALID_SESSION_CREDENTIAL",
      "Visitor session credential is invalid, expired or revoked.",
    );
  }
  return workspace;
}

function buildView(
  publication: Parameters<typeof buildVisitorSessionModelFromState>[0],
  workspace: VisitorSessionWorkspace,
): VisitorScenarioViewReadModel {
  const model = buildVisitorSessionModelFromState(publication, workspace);
  return buildVisitorScenarioViewReadModel(publication, workspace, model);
}
