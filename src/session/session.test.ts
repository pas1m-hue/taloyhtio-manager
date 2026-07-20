import { describe, expect, it } from "vitest";
import {
  type AdminDataBatchCommand,
  type CreateVisitorSessionCommand,
  type PublishAdminDataCommand,
  type SessionEventOverride,
  type VisitorSessionBatchCommand,
} from "../domain/types.js";
import { commitAdminBatch } from "../admin/adminEntryService.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { InMemoryPublishingRepository } from "../publishing/publicationRepository.js";
import { publishAdminData } from "../publishing/publishAdminData.js";
import { createPublishedDataSnapshot } from "../publishing/publishedSnapshot.js";
import { buildVisitorSessionModel } from "./buildVisitorSessionModel.js";
import { InMemorySessionWorkspaceRepository } from "./sessionRepository.js";
import {
  commitVisitorSessionBatch,
  startVisitorSession,
} from "./sessionService.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const CREATED_AT = "2026-07-17T18:00:00+03:00";
const UPDATED_AT = "2026-07-17T18:15:00+03:00";
const EXPIRES_AT = "2026-07-18T18:00:00+03:00";
const AS_OF = "2026-07-17T20:00:00+03:00";
const EVENT_ID = "event_exterior_wall_painting";
const ENTRY_ID = "base_2032";

function publishCommand(
  expectedAdminRevision = 0,
  expectedPublishedVersion = 0,
): PublishAdminDataCommand {
  return {
    companyId: COMPANY_ID,
    expectedAdminRevision,
    expectedPublishedVersion,
    publishedAt: CREATED_AT,
    publishedBy: "admin:pasi",
    sourceIds: ["board_publication_decision_2026"],
    explanation: "Admin published the reviewed workspace.",
  };
}

function sessionCommand(
  sessionId = "visitor-session-1",
  publicationVersion = 1,
): CreateVisitorSessionCommand {
  return {
    sessionId,
    companyId: COMPANY_ID,
    publicationVersion,
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    horizon: { startYear: 2026, endYear: 2057 },
  };
}

function batch(
  sessionId: string,
  operations: VisitorSessionBatchCommand["operations"],
  expectedRevision = 0,
  occurredAt = UPDATED_AT,
): VisitorSessionBatchCommand {
  return { sessionId, expectedRevision, occurredAt, operations };
}

function override(
  partial: Partial<SessionEventOverride> = {},
): SessionEventOverride {
  return {
    id: "override-facade-base",
    eventId: EVENT_ID,
    scheduleEntryId: ENTRY_ID,
    year: 2030,
    amount: 10_000,
    explanation: "Visitor tests an earlier and more expensive scenario row.",
    ...partial,
  };
}

async function publishedRepositories() {
  const publications = new InMemoryPublishingRepository([adminBaselineSnapshot]);
  await publishAdminData(publications, publishCommand());
  return {
    publications,
    sessions: new InMemorySessionWorkspaceRepository(),
  };
}

function adminCommand(
  operations: AdminDataBatchCommand["operations"],
): AdminDataBatchCommand {
  return {
    companyId: COMPANY_ID,
    expectedRevision: 0,
    actorId: "admin:pasi",
    occurredAt: "2026-07-17T18:30:00+03:00",
    operations,
  };
}

describe("V2.3 visitor session workspace", () => {
  it("pins a new session to one exact immutable publication", async () => {
    const { publications, sessions } = await publishedRepositories();
    const workspace = await startVisitorSession(
      publications,
      sessions,
      sessionCommand(),
    );
    const publication = await publications.loadVersion(COMPANY_ID, 1);
    expect(workspace.publicationVersion).toBe(1);
    expect(workspace.publicationFingerprint).toBe(publication?.contentFingerprint);
    expect(workspace.revision).toBe(0);
    expect(workspace.eventOverrides).toEqual([]);
  });

  it("produces the published projection unchanged before session edits", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.modificationCount).toBe(0);
    expect(model.projection.scenarios.base.horizonAmount).toBe(0);
    expect(model.liquidity.status).toBe("available");
  });

  it("changes only the targeted schedule row inside the visitor session", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_event_override",
      value: override(),
    }]));

    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    const row = model.effectiveApprovedEvents
      .find((event) => event.id === EVENT_ID)?.schedule
      .find((entry) => entry.id === ENTRY_ID);
    expect(row).toMatchObject({ year: 2030, amount: 10_000 });
    expect(model.projection.scenarios.base.years
      .find((year) => year.year === 2030)?.amount).toBe(10_000);
    expect(model.projection.scenarios.optimistic.horizonAmount).toBe(0);
  });

  it("does not mutate the immutable publication when a visitor edits", async () => {
    const { publications, sessions } = await publishedRepositories();
    const before = await publications.loadVersion(COMPANY_ID, 1);
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_event_override",
      value: override(),
    }]));
    await buildVisitorSessionModel(publications, sessions, "visitor-session-1", AS_OF);
    expect(await publications.loadVersion(COMPANY_ID, 1)).toEqual(before);
  });

  it("turns null amount into a named session DATA GAP instead of zero", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_event_override",
      value: override({ amount: null }),
    }]));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.projection.scenarios.base.horizonAmount).toBe(0);
    expect(model.projection.scenarios.base.dataGaps.withinHorizon.some((gap) =>
      gap.eventId === EVENT_ID && gap.scheduleEntryId === ENTRY_ID
    )).toBe(true);
  });

  it("can exclude one explicit row without removing the other scenarios", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_event_override",
      value: {
        id: "exclude-facade-base",
        eventId: EVENT_ID,
        scheduleEntryId: ENTRY_ID,
        excluded: true,
      },
    }]));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    const event = model.effectiveApprovedEvents.find((item) => item.id === EVENT_ID);
    expect(event?.schedule.some((entry) => entry.id === ENTRY_ID)).toBe(false);
    expect(event?.schedule).toHaveLength(2);
  });

  it("adds a temporary custom event with numeric and DATA GAP rows", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_custom_event",
      value: {
        id: "custom-yard-study",
        assetId: "asset_yard_asphalt",
        title: "Visitorin kokeellinen pihatutkimus",
        type: "study",
        schedule: [
          { id: "base", scenario: "base", year: 2029, amount: 2_500 },
          { id: "stress", scenario: "stress", year: 2028 },
        ],
      },
    }]));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.projection.scenarios.base.horizonAmount).toBe(2_500);
    expect(model.projection.scenarios.stress.dataGaps.withinHorizon.some((gap) =>
      gap.title === "Visitorin kokeellinen pihatutkimus"
    )).toBe(true);
  });

  it("rejects an override that targets a missing published row", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_event_override",
      value: override({ scheduleEntryId: "missing-row" }),
    }]));
    await expect(buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    )).rejects.toMatchObject({ code: "INVALID_SESSION_DATA" });
  });

  it("rejects a custom event on a missing asset", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_custom_event",
      value: {
        id: "bad-custom",
        assetId: "missing-asset",
        title: "Virheellinen tapahtuma",
        type: "repair",
        schedule: [{ id: "base", scenario: "base", year: 2030, amount: 1_000 }],
      },
    }]));
    await expect(buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    )).rejects.toMatchObject({ code: "INVALID_SESSION_DATA" });
  });

  it("supports different repair collections in separate scenarios", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "set_liquidity_overrides",
      value: {
        annualRepairCollectionByScenario: {
          base: 20_000,
          stress: 30_000,
        },
      },
    }]));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    if (model.liquidity.status !== "available") throw new Error("fixture requires liquidity");
    expect(model.liquidity.forecast.scenarios.base.cashPath.annualRepairCollection)
      .toBe(20_000);
    expect(model.liquidity.forecast.scenarios.stress.cashPath.annualRepairCollection)
      .toBe(30_000);
    expect(model.liquidity.forecast.scenarios.optimistic.cashPath.annualRepairCollection)
      .toBe(9_680);
  });

  it("supports session-only cash and operating-buffer assumptions", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "set_liquidity_overrides",
      value: {
        currentCash: 50_000,
        trailing12mOperatingCosts: 48_000,
        bufferMonths: 4,
        operatingBufferTarget: null,
      },
    }]));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    if (model.liquidity.status !== "available") throw new Error("fixture requires liquidity");
    expect(model.liquidity.assumptions.currentCash).toBe(50_000);
    expect(model.liquidity.forecast.operatingBuffer.operatingBufferTarget)
      .toBe(16_000);
  });

  it("resets all visitor deltas and restores the original horizon", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [
      { type: "save_event_override", value: override() },
      { type: "set_horizon", value: { startYear: 2030, endYear: 2040 } },
      { type: "set_liquidity_overrides", value: { currentCash: 50_000 } },
    ]));
    await commitVisitorSessionBatch(sessions, batch(
      "visitor-session-1",
      [{ type: "reset_workspace" }],
      1,
      "2026-07-17T18:30:00+03:00",
    ));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.modificationCount).toBe(0);
    expect(model.horizon).toEqual({ startYear: 2026, endYear: 2057 });
    expect(model.projection.scenarios.base.horizonAmount).toBe(0);
  });

  it("blocks stale session revisions", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_event_override",
      value: override(),
    }]));
    await expect(commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "set_horizon",
      value: { startYear: 2027, endYear: 2050 },
    }]))).rejects.toMatchObject({ code: "SESSION_REVISION_CONFLICT" });
  });

  it("blocks use after the session expiry", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await expect(buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      EXPIRES_AT,
    )).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("keeps two visitor sessions isolated", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand("session-a"));
    await startVisitorSession(publications, sessions, sessionCommand("session-b"));
    await commitVisitorSessionBatch(sessions, batch("session-a", [{
      type: "save_event_override",
      value: override(),
    }]));
    const a = await buildVisitorSessionModel(publications, sessions, "session-a", AS_OF);
    const b = await buildVisitorSessionModel(publications, sessions, "session-b", AS_OF);
    expect(a.projection.scenarios.base.horizonAmount).toBe(10_000);
    expect(b.projection.scenarios.base.horizonAmount).toBe(0);
  });

  it("keeps an existing session pinned when admin publishes version two", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitAdminBatch(publications, adminCommand([{
      type: "save_housing_company",
      value: { ...adminBaselineSnapshot.housingCompany, name: "Julkaisuversio 2" },
      sourceIds: ["admin_form_2026"],
      explanation: "Admin updated the company name.",
    }]));
    await publishAdminData(publications, {
      ...publishCommand(1, 1),
      publishedAt: "2026-07-17T19:00:00+03:00",
    });
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.publicationVersion).toBe(1);
  });

  it("returns unavailable liquidity without a baseline", async () => {
    const adminWithoutBaseline = {
      ...adminBaselineSnapshot,
      liquidityBaselines: [],
    };
    const publication = createPublishedDataSnapshot(
      adminWithoutBaseline,
      publishCommand(),
    );
    const publications = new InMemoryPublishingRepository([], [publication]);
    const sessions = new InMemorySessionWorkspaceRepository();
    await startVisitorSession(publications, sessions, sessionCommand());
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.liquidity).toEqual({
      status: "unavailable",
      missingFields: [
        "currentCash",
        "trailing12mOperatingCosts",
        "currentAnnualRepairCollection",
      ],
    });
  });

  it("enables liquidity without a published baseline when all inputs are entered", async () => {
    const adminWithoutBaseline = {
      ...adminBaselineSnapshot,
      liquidityBaselines: [],
    };
    const publication = createPublishedDataSnapshot(
      adminWithoutBaseline,
      publishCommand(),
    );
    const publications = new InMemoryPublishingRepository([], [publication]);
    const sessions = new InMemorySessionWorkspaceRepository();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "set_liquidity_overrides",
      value: {
        currentCash: 20_000,
        trailing12mOperatingCosts: 36_000,
        annualRepairCollectionByScenario: {
          optimistic: 5_000,
          base: 7_500,
          stress: 10_000,
        },
      },
    }]));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.liquidity.status).toBe("available");
  });

  it("rejects duplicate overrides for the same published row", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await expect(commitVisitorSessionBatch(sessions, batch("visitor-session-1", [
      { type: "save_event_override", value: override({ id: "one" }) },
      { type: "save_event_override", value: override({ id: "two", amount: 20_000 }) },
    ]))).rejects.toMatchObject({ code: "INVALID_SESSION_DATA" });
  });

  it("can undo one event override without resetting other session settings", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [
      { type: "save_event_override", value: override() },
      { type: "set_liquidity_overrides", value: { currentCash: 40_000 } },
    ]));
    await commitVisitorSessionBatch(sessions, batch(
      "visitor-session-1",
      [{ type: "remove_event_override", overrideId: "override-facade-base" }],
      1,
      "2026-07-17T18:30:00+03:00",
    ));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.projection.scenarios.base.horizonAmount).toBe(0);
    expect(model.modificationCount).toBe(1);
    if (model.liquidity.status !== "available") throw new Error("fixture requires liquidity");
    expect(model.liquidity.assumptions.currentCash).toBe(40_000);
  });

  it("can remove one temporary custom event", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "save_custom_event",
      value: {
        id: "temporary-repair",
        assetId: "asset_roof_maintenance",
        title: "Tilapäinen visitor-korjaus",
        type: "repair",
        schedule: [{ id: "base", scenario: "base", year: 2027, amount: 4_000 }],
      },
    }]));
    await commitVisitorSessionBatch(sessions, batch(
      "visitor-session-1",
      [{ type: "remove_custom_event", customEventId: "temporary-repair" }],
      1,
      "2026-07-17T18:30:00+03:00",
    ));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.modificationCount).toBe(0);
    expect(model.projection.scenarios.base.horizonAmount).toBe(0);
  });

  it("uses the session horizon without changing the publication", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await commitVisitorSessionBatch(sessions, batch("visitor-session-1", [{
      type: "set_horizon",
      value: { startYear: 2026, endYear: 2070 },
    }]));
    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(model.projection.scenarios.base.dataGaps.withinHorizon.some((gap) =>
      gap.eventId === "event_foundations" && gap.year === 2062
    )).toBe(true);
    expect((await publications.loadVersion(COMPANY_ID, 1))?.events
      .some((event) => event.id === "event_foundations")).toBe(true);
  });

  it("rejects a session whose publication fingerprint was tampered", async () => {
    const { publications, sessions } = await publishedRepositories();
    const workspace = await startVisitorSession(
      publications,
      sessions,
      sessionCommand(),
    );
    const tampered = new InMemorySessionWorkspaceRepository([{
      ...workspace,
      publicationFingerprint: "fnv1a64:tampered",
    }]);
    await expect(buildVisitorSessionModel(
      publications,
      tampered,
      "visitor-session-1",
      AS_OF,
    )).rejects.toMatchObject({ code: "SESSION_PUBLICATION_MISMATCH" });
  });

  it("rejects a session read before its creation time", async () => {
    const { publications, sessions } = await publishedRepositories();
    await startVisitorSession(publications, sessions, sessionCommand());
    await expect(buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      "2026-07-17T17:59:59+03:00",
    )).rejects.toMatchObject({ code: "INVALID_SESSION_DATA" });
  });

  it("returns defensive copies from session storage and model building", async () => {
    const { publications, sessions } = await publishedRepositories();
    const created = await startVisitorSession(publications, sessions, sessionCommand());
    ((created.horizon as unknown) as { startYear: number }).startYear = 1900;
    expect((await sessions.load("visitor-session-1"))?.horizon.startYear).toBe(2026);

    const model = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    ((model.effectiveApprovedEvents as unknown) as { title: string }[])[0]!.title = "mutated";
    const again = await buildVisitorSessionModel(
      publications,
      sessions,
      "visitor-session-1",
      AS_OF,
    );
    expect(again.effectiveApprovedEvents[0]?.title).not.toBe("mutated");
  });
});
