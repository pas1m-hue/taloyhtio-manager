import { describe, expect, it } from "vitest";
import type {
  AdminDataBatchCommand,
  BuildingEvent,
  CostEvidence,
  CreateVisitorSessionCommand,
  Horizon,
  PublishAdminDataCommand,
  VisitorSessionBatchCommand,
} from "../domain/types.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { InMemoryPublishingRepository } from "../publishing/publicationRepository.js";
import { InMemorySessionWorkspaceRepository } from "../session/sessionRepository.js";
import {
  applyAdminChanges,
  loadAdminWorkspace,
  previewAdminCalculations,
} from "./adminApplicationService.js";
import {
  loadPublicationHistory,
  publishAdminRevision,
} from "./publishingApplicationService.js";
import {
  applyVisitorSessionChanges,
  createVisitorSession,
  loadPublishedOverview,
  loadVisitorScenario,
  resetVisitorSession,
} from "./visitorApplicationService.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const HORIZON: Horizon = { startYear: 2026, endYear: 2057 };
const PUBLISHED_AT = "2026-07-17T19:00:00+03:00";
const SESSION_CREATED_AT = "2026-07-17T20:00:00+03:00";
const SESSION_UPDATED_AT = "2026-07-17T20:15:00+03:00";
const SESSION_EXPIRES_AT = "2026-07-18T20:00:00+03:00";

function publishCommand(
  expectedAdminRevision: number,
  expectedPublishedVersion: number,
  publishedAt = PUBLISHED_AT,
): PublishAdminDataCommand {
  return {
    companyId: COMPANY_ID,
    expectedAdminRevision,
    expectedPublishedVersion,
    publishedAt,
    publishedBy: "admin:pasi",
    sourceIds: [`publication_${expectedPublishedVersion + 1}`],
    explanation: `Publish reviewed version ${expectedPublishedVersion + 1}.`,
  };
}

function adminBatch(
  expectedRevision: number,
  operations: AdminDataBatchCommand["operations"],
): AdminDataBatchCommand {
  return {
    companyId: COMPANY_ID,
    expectedRevision,
    actorId: "admin:pasi",
    occurredAt: `2026-07-17T19:${String(expectedRevision + 1).padStart(2, "0")}:00+03:00`,
    operations,
  };
}

function numericEventOperations(
  id = "manual_balcony_repair",
  amount = 12_500,
): AdminDataBatchCommand["operations"] {
  const evidence: CostEvidence = {
    id: `evidence_${id}`,
    assetId: "asset_balcony_soffit_treatment",
    eventId: `event_${id}`,
    status: "estimate",
    amount,
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "manual_budget_estimate_2026",
  };
  const event: BuildingEvent = {
    id: `event_${id}`,
    assetId: "asset_balcony_soffit_treatment",
    title: "Parvekkeiden paikallinen korjaus",
    type: "repair",
    status: "approved",
    origin: "manual",
    sourceIds: ["manual_budget_estimate_2026"],
    schedule: [{
      id: "base_2028",
      scenario: "base",
      year: 2028,
      amount,
      costEvidenceId: evidence.id,
      explanation: "Adminin syöttämä arvio.",
    }],
  };
  return [
    {
      type: "save_cost_evidence",
      value: evidence,
      sourceIds: ["manual_budget_estimate_2026"],
      explanation: "Add reviewed numeric estimate.",
    },
    {
      type: "save_building_event",
      value: event,
      sourceIds: ["manual_budget_estimate_2026"],
      explanation: "Add approved repair event.",
    },
  ];
}

function suggestedOnlyOperations(): AdminDataBatchCommand["operations"] {
  const evidence: CostEvidence = {
    id: "gap_suggested_window_study",
    assetId: "asset_exterior_wall_painting",
    eventId: "event_suggested_window_study",
    status: "data_gap",
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "board_note_2026",
  };
  const event: BuildingEvent = {
    id: "event_suggested_window_study",
    assetId: "asset_exterior_wall_painting",
    title: "Ikkunoiden kuntotutkimusluonnos",
    type: "study",
    status: "suggested",
    origin: "document_update",
    sourceIds: ["board_note_2026"],
    schedule: [{
      id: "base_2029",
      scenario: "base",
      year: 2029,
      costEvidenceId: evidence.id,
      explanation: "Adminin luonnos, ei hyväksytty.",
    }],
  };
  return [
    {
      type: "save_cost_evidence",
      value: evidence,
      sourceIds: ["board_note_2026"],
      explanation: "Store source-backed draft gap.",
    },
    {
      type: "save_building_event",
      value: event,
      sourceIds: ["board_note_2026"],
      explanation: "Store suggested event draft.",
    },
  ];
}

function sessionCommand(): CreateVisitorSessionCommand {
  return {
    sessionId: "visitor-app-session",
    companyId: COMPANY_ID,
    publicationVersion: 1,
    createdAt: SESSION_CREATED_AT,
    expiresAt: SESSION_EXPIRES_AT,
    horizon: HORIZON,
  };
}

function sessionBatch(
  expectedRevision: number,
  operations: VisitorSessionBatchCommand["operations"],
  occurredAt = SESSION_UPDATED_AT,
): VisitorSessionBatchCommand {
  return {
    sessionId: "visitor-app-session",
    expectedRevision,
    occurredAt,
    operations,
  };
}

async function publishedRepository() {
  const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
  await publishAdminRevision(repository, publishCommand(0, 0));
  return repository;
}

describe("V2.4 application services and UI read models", () => {
  it("loads an unpublished admin workspace without exposing repository details", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const dashboard = await loadAdminWorkspace(repository, COMPANY_ID, HORIZON);
    expect(dashboard.adminRevision).toBe(0);
    expect(dashboard.publication.latestPublicationVersion).toBe(0);
    expect(dashboard.publication.publishableChanges).toBe(true);
    expect(dashboard.calculations.projection.scenarios.base.dataGaps.withinHorizon.length)
      .toBeGreaterThan(0);
    expect(dashboard.calculations.liquidity.status).toBe("available");
  });

  it("reports no workspace or publishable changes immediately after publication", async () => {
    const repository = await publishedRepository();
    const dashboard = await loadAdminWorkspace(repository, COMPANY_ID, HORIZON);
    expect(dashboard.publication).toMatchObject({
      latestPublicationVersion: 1,
      latestPublishedAdminRevision: 0,
      workspaceChangedSincePublication: false,
      publishableChanges: false,
      unpublishedAuditEntryCount: 0,
    });
  });

  it("applies one admin batch and returns a refreshed calculated dashboard", async () => {
    const repository = await publishedRepository();
    const dashboard = await applyAdminChanges(
      repository,
      adminBatch(0, numericEventOperations()),
      HORIZON,
    );
    expect(dashboard.adminRevision).toBe(1);
    expect(dashboard.publication.workspaceChangedSincePublication).toBe(true);
    expect(dashboard.publication.publishableChanges).toBe(true);
    expect(dashboard.publication.unpublishedAuditEntryCount).toBe(2);
    expect(dashboard.calculations.projection.scenarios.base.horizonAmount).toBe(12_500);
  });

  it("distinguishes draft-only workspace edits from publishable changes", async () => {
    const repository = await publishedRepository();
    const dashboard = await applyAdminChanges(
      repository,
      adminBatch(0, suggestedOnlyOperations()),
      HORIZON,
    );
    expect(dashboard.publication.workspaceChangedSincePublication).toBe(true);
    expect(dashboard.publication.publishableChanges).toBe(false);
    expect(dashboard.counts.suggestedEvents).toBe(1);
    expect(dashboard.calculations.projection.suggestions).toHaveLength(1);
  });

  it("returns the same deterministic calculation preview as the full dashboard", async () => {
    const repository = await publishedRepository();
    await applyAdminChanges(repository, adminBatch(0, numericEventOperations()), HORIZON);
    const preview = await previewAdminCalculations(repository, COMPANY_ID, HORIZON);
    const dashboard = await loadAdminWorkspace(repository, COMPANY_ID, HORIZON);
    expect(preview).toEqual(dashboard.calculations);
  });

  it("fails loudly when the admin workspace does not exist", async () => {
    const repository = new InMemoryPublishingRepository();
    await expect(loadAdminWorkspace(repository, "missing", HORIZON))
      .rejects.toMatchObject({ code: "ADMIN_DATA_NOT_FOUND" });
    await expect(previewAdminCalculations(repository, "missing", HORIZON))
      .rejects.toMatchObject({ code: "ADMIN_DATA_NOT_FOUND" });
  });

  it("publishes through one application boundary and returns compact metadata", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const result = await publishAdminRevision(repository, publishCommand(0, 0));
    expect(result).toMatchObject({
      companyId: COMPANY_ID,
      publicationVersion: 1,
      sourceAdminRevision: 0,
      publishedBy: "admin:pasi",
    });
    expect(result).not.toHaveProperty("events");
  });

  it("loads publication history newest first", async () => {
    const repository = await publishedRepository();
    await applyAdminChanges(repository, adminBatch(0, numericEventOperations()), HORIZON);
    await publishAdminRevision(
      repository,
      publishCommand(1, 1, "2026-07-17T21:00:00+03:00"),
    );
    const history = await loadPublicationHistory(repository, COMPANY_ID);
    expect(history.currentPublicationVersion).toBe(2);
    expect(history.versions.map((item) => item.publicationVersion)).toEqual([2, 1]);
  });

  it("returns defensive publication-history copies", async () => {
    const repository = await publishedRepository();
    const history = await loadPublicationHistory(repository, COMPANY_ID);
    (history.versions[0]!.sourceIds as string[]).push("mutated");
    const again = await loadPublicationHistory(repository, COMPANY_ID);
    expect(again.versions[0]!.sourceIds).not.toContain("mutated");
  });

  it("builds a visitor overview only from the latest immutable publication", async () => {
    const repository = await publishedRepository();
    await applyAdminChanges(repository, adminBatch(0, suggestedOnlyOperations()), HORIZON);
    const overview = await loadPublishedOverview(repository, COMPANY_ID, HORIZON);
    expect(overview.publicationVersion).toBe(1);
    expect(overview.data.approvedEvents.length).toBeGreaterThan(0);
    expect(overview.data.approvedEvents.some((event) =>
      event.id === "event_suggested_window_study"
    )).toBe(false);
    expect(overview.calculations.projection.suggestions).toEqual([]);
  });

  it("fails loudly before the first publication", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    await expect(loadPublishedOverview(repository, COMPANY_ID, HORIZON))
      .rejects.toMatchObject({ code: "PUBLISHED_DATA_NOT_FOUND" });
  });

  it("creates a complete session-only visitor scenario read model", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemorySessionWorkspaceRepository();
    const view = await createVisitorSession(publications, sessions, sessionCommand());
    expect(view.persistenceMode).toBe("session_only");
    expect(view.sessionRevision).toBe(0);
    expect(view.changes.modificationCount).toBe(0);
    expect(view.publishedData.publicationVersion).toBe(1);
    expect(view.liquidity.status).toBe("available");
  });

  it("applies visitor changes and returns one refreshed UI model", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemorySessionWorkspaceRepository();
    await createVisitorSession(publications, sessions, sessionCommand());
    const view = await applyVisitorSessionChanges(
      publications,
      sessions,
      sessionBatch(0, [{
        type: "save_event_override",
        value: {
          id: "override-facade",
          eventId: "event_exterior_wall_painting",
          scheduleEntryId: "base_2032",
          year: 2030,
          amount: 10_000,
          explanation: "Visitor test scenario.",
        },
      }]),
    );
    expect(view.sessionRevision).toBe(1);
    expect(view.changes.modificationCount).toBe(1);
    expect(view.changes.eventOverrides).toHaveLength(1);
    expect(view.projection.scenarios.base.years
      .find((year) => year.year === 2030)?.amount).toBe(10_000);
  });

  it("resets all visitor deltas without changing the pinned publication", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemorySessionWorkspaceRepository();
    await createVisitorSession(publications, sessions, sessionCommand());
    await applyVisitorSessionChanges(
      publications,
      sessions,
      sessionBatch(0, [{
        type: "set_horizon",
        value: { startYear: 2030, endYear: 2040 },
      }]),
    );
    const reset = await resetVisitorSession(publications, sessions, {
      sessionId: "visitor-app-session",
      expectedRevision: 1,
      occurredAt: "2026-07-17T20:30:00+03:00",
    });
    expect(reset.sessionRevision).toBe(2);
    expect(reset.horizon).toEqual(HORIZON);
    expect(reset.changes.modificationCount).toBe(0);
    expect(reset.publicationVersion).toBe(1);
  });

  it("keeps an open session pinned when a newer publication is created", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemorySessionWorkspaceRepository();
    await createVisitorSession(publications, sessions, sessionCommand());
    await applyAdminChanges(publications, adminBatch(0, numericEventOperations()), HORIZON);
    await publishAdminRevision(
      publications,
      publishCommand(1, 1, "2026-07-17T21:00:00+03:00"),
    );
    const session = await loadVisitorScenario(
      publications,
      sessions,
      "visitor-app-session",
      "2026-07-17T21:15:00+03:00",
    );
    const current = await loadPublishedOverview(publications, COMPANY_ID, HORIZON);
    expect(session.publicationVersion).toBe(1);
    expect(current.publicationVersion).toBe(2);
    expect(session.projection.scenarios.base.horizonAmount).toBe(0);
    expect(current.calculations.projection.scenarios.base.horizonAmount).toBe(12_500);
  });

  it("propagates stale admin and session revisions as explicit conflicts", async () => {
    const publications = await publishedRepository();
    await applyAdminChanges(publications, adminBatch(0, numericEventOperations()), HORIZON);
    await expect(applyAdminChanges(
      publications,
      adminBatch(0, numericEventOperations("another_event")),
      HORIZON,
    )).rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });

    const sessions = new InMemorySessionWorkspaceRepository();
    await createVisitorSession(publications, sessions, sessionCommand());
    await applyVisitorSessionChanges(
      publications,
      sessions,
      sessionBatch(0, [{ type: "set_horizon", value: { startYear: 2027, endYear: 2040 } }]),
    );
    await expect(applyVisitorSessionChanges(
      publications,
      sessions,
      sessionBatch(0, [{ type: "set_horizon", value: { startYear: 2028, endYear: 2041 } }]),
    )).rejects.toMatchObject({ code: "SESSION_REVISION_CONFLICT" });
  });

  it("does not let read-model mutation alter stored admin, publication, or session state", async () => {
    const publications = await publishedRepository();
    const sessions = new InMemorySessionWorkspaceRepository();
    const admin = await loadAdminWorkspace(publications, COMPANY_ID, HORIZON);
    ((admin.assets as unknown) as { name: string }[])[0]!.name = "mutated";
    const overview = await loadPublishedOverview(publications, COMPANY_ID, HORIZON);
    ((overview.data.assets as unknown) as { name: string }[])[0]!.name = "mutated";
    const session = await createVisitorSession(publications, sessions, sessionCommand());
    ((session.publishedData.assets as unknown) as { name: string }[])[0]!.name = "mutated";

    expect((await loadAdminWorkspace(publications, COMPANY_ID, HORIZON)).assets[0]!.name)
      .not.toBe("mutated");
    expect((await loadPublishedOverview(publications, COMPANY_ID, HORIZON)).data.assets[0]!.name)
      .not.toBe("mutated");
    expect((await loadVisitorScenario(
      publications,
      sessions,
      "visitor-app-session",
      SESSION_UPDATED_AT,
    )).publishedData.assets[0]!.name).not.toBe("mutated");
  });
});
