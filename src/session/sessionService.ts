import {
  DomainValidationError,
  type CreateVisitorSessionCommand,
  type VisitorSessionBatchCommand,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import type { PublicationRepository } from "../publishing/publicationRepository.js";
import type { SessionWorkspaceRepository } from "./sessionRepository.js";
import {
  applyVisitorSessionBatch,
  createVisitorSessionWorkspace,
  validateVisitorSessionWorkspace,
} from "./sessionWorkspace.js";

export async function startVisitorSession(
  publications: PublicationRepository,
  sessions: SessionWorkspaceRepository,
  command: CreateVisitorSessionCommand,
): Promise<VisitorSessionWorkspace> {
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
  return sessions.create(createVisitorSessionWorkspace(publication, command));
}

export async function commitVisitorSessionBatch(
  sessions: SessionWorkspaceRepository,
  command: VisitorSessionBatchCommand,
): Promise<VisitorSessionWorkspace> {
  const current = await requireSession(sessions, command.sessionId);
  const next = applyVisitorSessionBatch(current, command);
  return sessions.save(command.sessionId, command.expectedRevision, next);
}

export async function requireActiveVisitorSession(
  sessions: SessionWorkspaceRepository,
  sessionId: string,
  asOf: string,
): Promise<VisitorSessionWorkspace> {
  const workspace = await requireSession(sessions, sessionId);
  if (!validDate(asOf)) {
    throw new DomainValidationError(
      "INVALID_SESSION_DATA",
      `Session asOf ${asOf} is invalid.`,
    );
  }
  if (Date.parse(asOf) < Date.parse(workspace.createdAt)) {
    throw new DomainValidationError(
      "INVALID_SESSION_DATA",
      `Session ${sessionId} cannot be read before ${workspace.createdAt}.`,
    );
  }
  if (Date.parse(asOf) >= Date.parse(workspace.expiresAt)) {
    throw new DomainValidationError(
      "SESSION_EXPIRED",
      `Session ${sessionId} expired at ${workspace.expiresAt}.`,
    );
  }
  return workspace;
}

async function requireSession(
  sessions: SessionWorkspaceRepository,
  sessionId: string,
): Promise<VisitorSessionWorkspace> {
  const workspace = await sessions.load(sessionId);
  if (workspace === undefined) {
    throw new DomainValidationError(
      "SESSION_NOT_FOUND",
      `Session ${sessionId} does not exist.`,
    );
  }
  validateVisitorSessionWorkspace(workspace);
  return workspace;
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}
