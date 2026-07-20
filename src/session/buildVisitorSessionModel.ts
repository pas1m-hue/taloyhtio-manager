import {
  DomainValidationError,
  type FutureBuildingEvent,
  type VisitorSessionModel,
} from "../domain/types.js";
import { buildProjection } from "../projection/buildProjection.js";
import type { PublicationRepository } from "../publishing/publicationRepository.js";
import type { SessionWorkspaceRepository } from "./sessionRepository.js";
import { buildEffectiveSessionData } from "./applySessionChanges.js";
import { buildSessionLiquidityModel } from "./buildSessionLiquidity.js";
import { requireActiveVisitorSession } from "./sessionService.js";

export async function buildVisitorSessionModel(
  publications: PublicationRepository,
  sessions: SessionWorkspaceRepository,
  sessionId: string,
  asOf: string,
): Promise<VisitorSessionModel> {
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
  return buildVisitorSessionModelFromState(publication, workspace);
}

/** Pure composition used by the application boundary after one session read. */
export function buildVisitorSessionModelFromState(
  publication: import("../domain/types.js").PublishedDataSnapshot,
  workspace: import("../domain/types.js").VisitorSessionWorkspace,
): VisitorSessionModel {
  const effective = buildEffectiveSessionData(publication, workspace);
  const projection = buildProjection({
    assets: effective.assets,
    events: effective.events,
    costEvidence: effective.costEvidence,
    priceLevelConfirmations: effective.priceLevelConfirmations,
    horizon: workspace.horizon,
  });
  const effectiveApprovedEvents = effective.events.filter(
    (event): event is FutureBuildingEvent => event.status === "approved",
  );
  return structuredClone({
    sessionId: workspace.sessionId,
    sessionRevision: workspace.revision,
    companyId: workspace.companyId,
    publicationVersion: workspace.publicationVersion,
    publicationFingerprint: workspace.publicationFingerprint,
    horizon: workspace.horizon,
    effectiveApprovedEvents,
    projection,
    liquidity: buildSessionLiquidityModel(publication, workspace, projection),
    modificationCount: countModifications(workspace),
  });
}

function countModifications(workspace: {
  readonly eventOverrides: readonly unknown[];
  readonly customEvents: readonly unknown[];
  readonly horizon: { readonly startYear: number; readonly endYear: number };
  readonly baseHorizon: { readonly startYear: number; readonly endYear: number };
  readonly liquidityOverrides: object;
}): number {
  return workspace.eventOverrides.length + workspace.customEvents.length +
    (workspace.horizon.startYear === workspace.baseHorizon.startYear &&
      workspace.horizon.endYear === workspace.baseHorizon.endYear ? 0 : 1) +
    (Object.keys(workspace.liquidityOverrides).length === 0 ? 0 : 1);
}
