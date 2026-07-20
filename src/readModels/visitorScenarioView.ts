import {
  DomainValidationError,
  type PublishedDataSnapshot,
  type VisitorSessionModel,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import { buildVisitorPublishedView } from "../publishing/visitorPublishedView.js";

export interface VisitorScenarioChangesReadModel {
  readonly modificationCount: number;
  readonly eventOverrides: VisitorSessionWorkspace["eventOverrides"];
  readonly customEvents: VisitorSessionWorkspace["customEvents"];
  readonly liquidityOverrides: VisitorSessionWorkspace["liquidityOverrides"];
  readonly horizonChanged: boolean;
}

export interface VisitorScenarioViewReadModel {
  readonly persistenceMode: "session_only";
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly publicationFingerprint: string;
  readonly publishedAt: string;
  readonly publishedData: ReturnType<typeof buildVisitorPublishedView>;
  readonly changes: VisitorScenarioChangesReadModel;
  readonly horizon: VisitorSessionModel["horizon"];
  readonly effectiveApprovedEvents: VisitorSessionModel["effectiveApprovedEvents"];
  readonly projection: VisitorSessionModel["projection"];
  readonly liquidity: VisitorSessionModel["liquidity"];
}

export function buildVisitorScenarioViewReadModel(
  publication: PublishedDataSnapshot,
  workspace: VisitorSessionWorkspace,
  model: VisitorSessionModel,
): VisitorScenarioViewReadModel {
  if (publication.publicationVersion !== workspace.publicationVersion ||
      publication.contentFingerprint !== workspace.publicationFingerprint ||
      model.sessionRevision !== workspace.revision) {
    throw new DomainValidationError(
      "SESSION_PUBLICATION_MISMATCH",
      "Visitor scenario inputs do not describe the same session state.",
    );
  }
  return structuredClone({
    persistenceMode: "session_only" as const,
    sessionId: workspace.sessionId,
    sessionRevision: workspace.revision,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    expiresAt: workspace.expiresAt,
    companyId: workspace.companyId,
    publicationVersion: workspace.publicationVersion,
    publicationFingerprint: workspace.publicationFingerprint,
    publishedAt: publication.publishedAt,
    publishedData: buildVisitorPublishedView(publication),
    changes: {
      modificationCount: model.modificationCount,
      eventOverrides: workspace.eventOverrides,
      customEvents: workspace.customEvents,
      liquidityOverrides: workspace.liquidityOverrides,
      horizonChanged: workspace.horizon.startYear !== workspace.baseHorizon.startYear ||
        workspace.horizon.endYear !== workspace.baseHorizon.endYear,
    },
    horizon: model.horizon,
    effectiveApprovedEvents: model.effectiveApprovedEvents,
    projection: model.projection,
    liquidity: model.liquidity,
  });
}
