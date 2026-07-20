import {
  DomainValidationError,
  type CreateVisitorSessionCommand,
  type Horizon,
  type VisitorSessionBatchCommand,
} from "../domain/types.js";
import type { PublicationRepository } from "../publishing/publicationRepository.js";
import type { SessionWorkspaceRepository } from "../session/sessionRepository.js";
import {
  commitVisitorSessionBatch,
  requireActiveVisitorSession,
  startVisitorSession,
} from "../session/sessionService.js";
import { buildVisitorSessionModelFromState } from "../session/buildVisitorSessionModel.js";
import {
  buildPublishedOverviewReadModel,
  type PublishedOverviewReadModel,
} from "../readModels/publishedOverview.js";
import {
  buildVisitorScenarioViewReadModel,
  type VisitorScenarioViewReadModel,
} from "../readModels/visitorScenarioView.js";

export interface ResetVisitorSessionCommand {
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly occurredAt: string;
}

/** Latest published public view plus deterministic calculations. */
export async function loadPublishedOverview(
  publications: PublicationRepository,
  companyId: string,
  horizon: Horizon,
): Promise<PublishedOverviewReadModel> {
  const snapshot = await publications.loadCurrent(companyId);
  if (snapshot === undefined) {
    throw new DomainValidationError(
      "PUBLISHED_DATA_NOT_FOUND",
      `Published data ${companyId} does not exist.`,
    );
  }
  return buildPublishedOverviewReadModel(snapshot, horizon);
}

/** Starts an isolated visitor session and returns its complete UI model. */
export async function createVisitorSession(
  publications: PublicationRepository,
  sessions: SessionWorkspaceRepository,
  command: CreateVisitorSessionCommand,
): Promise<VisitorScenarioViewReadModel> {
  await startVisitorSession(publications, sessions, command);
  return loadVisitorScenario(
    publications,
    sessions,
    command.sessionId,
    command.createdAt,
  );
}

/** Applies deltas atomically and returns the refreshed scenario UI model. */
export async function applyVisitorSessionChanges(
  publications: PublicationRepository,
  sessions: SessionWorkspaceRepository,
  command: VisitorSessionBatchCommand,
): Promise<VisitorScenarioViewReadModel> {
  await commitVisitorSessionBatch(sessions, command);
  return loadVisitorScenario(
    publications,
    sessions,
    command.sessionId,
    command.occurredAt,
  );
}

/** Reads one active session pinned to its original publication. */
export async function loadVisitorScenario(
  publications: PublicationRepository,
  sessions: SessionWorkspaceRepository,
  sessionId: string,
  asOf: string,
): Promise<VisitorScenarioViewReadModel> {
  const workspace = await requireActiveVisitorSession(sessions, sessionId, asOf);
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
  const model = buildVisitorSessionModelFromState(publication, workspace);
  return buildVisitorScenarioViewReadModel(publication, workspace, model);
}

/** Clears all deltas but keeps the same session and pinned publication. */
export async function resetVisitorSession(
  publications: PublicationRepository,
  sessions: SessionWorkspaceRepository,
  command: ResetVisitorSessionCommand,
): Promise<VisitorScenarioViewReadModel> {
  return applyVisitorSessionChanges(publications, sessions, {
    sessionId: command.sessionId,
    expectedRevision: command.expectedRevision,
    occurredAt: command.occurredAt,
    operations: [{ type: "reset_workspace" }],
  });
}
