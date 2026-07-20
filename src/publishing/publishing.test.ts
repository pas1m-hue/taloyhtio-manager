import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  type AdminDataBatchCommand,
  type BuildingEvent,
  type CostEvidence,
  type PublishAdminDataCommand,
} from "../domain/types.js";
import { applyAdminBatch } from "../admin/applyAdminBatch.js";
import { commitAdminBatch } from "../admin/adminEntryService.js";
import { adminBaselineSnapshot } from "../fixtures/adminBaseline.js";
import { buildProjection } from "../projection/buildProjection.js";
import { InMemoryPublishingRepository } from "./publicationRepository.js";
import { publishAdminData } from "./publishAdminData.js";
import {
  createPublishedDataSnapshot,
  validatePublishedDataSnapshot,
} from "./publishedSnapshot.js";
import {
  buildVisitorPublishedView,
  loadVisitorPublishedView,
} from "./visitorPublishedView.js";

const COMPANY_ID = adminBaselineSnapshot.companyId;
const PUBLISHED_AT = "2026-07-17T18:00:00+03:00";

function publishCommand(
  expectedAdminRevision = 0,
  expectedPublishedVersion = 0,
): PublishAdminDataCommand {
  return {
    companyId: COMPANY_ID,
    expectedAdminRevision,
    expectedPublishedVersion,
    publishedAt: PUBLISHED_AT,
    publishedBy: "admin:pasi",
    sourceIds: ["board_publication_decision_2026"],
    explanation: "Admin reviewed and published the current workspace.",
  };
}

function adminCommand(
  operations: AdminDataBatchCommand["operations"],
  expectedRevision = 0,
): AdminDataBatchCommand {
  return {
    companyId: COMPANY_ID,
    expectedRevision,
    actorId: "admin:pasi",
    occurredAt: "2026-07-17T17:00:00+03:00",
    operations,
  };
}

function metadata() {
  return {
    sourceIds: ["admin_form_2026"],
    explanation: "Admin entered and reviewed the value manually.",
  } as const;
}

function suggestedDraft(): {
  readonly evidence: CostEvidence;
  readonly event: BuildingEvent;
} {
  const assetId = adminBaselineSnapshot.assets[0]?.id;
  if (assetId === undefined) {
    throw new Error("Fixture requires one asset.");
  }
  const eventId = "event_unpublished_draft";
  const evidence: CostEvidence = {
    id: "estimate_unpublished_draft",
    assetId,
    eventId,
    status: "estimate",
    amount: 5_000,
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "draft_note_2026",
  };
  const event: BuildingEvent = {
    id: eventId,
    assetId,
    title: "Keskeneräinen admin-luonnos",
    type: "study",
    status: "suggested",
    origin: "manual",
    sourceIds: ["draft_note_2026"],
    schedule: [{
      id: "base_2030",
      scenario: "base",
      year: 2030,
      amount: 5_000,
      costEvidenceId: evidence.id,
    }],
  };
  return { evidence, event };
}

function actualHistory(): {
  readonly evidence: CostEvidence;
  readonly event: BuildingEvent;
} {
  const assetId = adminBaselineSnapshot.assets[0]?.id;
  if (assetId === undefined) {
    throw new Error("Fixture requires one asset.");
  }
  const eventId = "event_actual_history_2026";
  const evidence: CostEvidence = {
    id: "actual_history_2026",
    assetId,
    eventId,
    status: "actual",
    amount: 1_200,
    unit: "project_total",
    priceLevelYear: 2026,
    sourceId: "invoice_2026_001",
  };
  const event: BuildingEvent = {
    id: eventId,
    assetId,
    title: "Toteutunut huolto",
    type: "maintenance",
    status: "actual",
    origin: "manual",
    sourceIds: ["invoice_2026_001"],
    actual: {
      year: 2026,
      occurredAt: "2026-06-01",
      amount: 1_200,
      costEvidenceId: evidence.id,
    },
  };
  return { evidence, event };
}

describe("V2.2 workspace and immutable publication", () => {
  it("publishes version one from one exact admin revision", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const published = await publishAdminData(repository, publishCommand());

    expect(published.publicationVersion).toBe(1);
    expect(published.sourceAdminRevision).toBe(0);
    expect(published.events.every((event) =>
      event.status === "approved" || event.status === "actual"
    )).toBe(true);
    expect("auditTrail" in published).toBe(false);
  });

  it("keeps admin workspace edits invisible until a new publication", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const first = await publishAdminData(repository, publishCommand());

    const updatedCompany = {
      ...adminBaselineSnapshot.housingCompany,
      name: "Työversiossa muutettu nimi",
    };
    await commitAdminBatch(repository, adminCommand([{
      type: "save_housing_company",
      value: updatedCompany,
      ...metadata(),
    }]));

    const visitorBeforePublish = await loadVisitorPublishedView(
      repository,
      COMPANY_ID,
    );
    expect(visitorBeforePublish.housingCompany.name)
      .toBe(first.housingCompany.name);
    expect(visitorBeforePublish.sourceAdminRevision).toBe(0);

    const second = await publishAdminData(
      repository,
      {
        ...publishCommand(1, 1),
        publishedAt: "2026-07-17T19:00:00+03:00",
      },
    );
    expect(second.publicationVersion).toBe(2);
    expect(second.housingCompany.name).toBe(updatedCompany.name);
  });

  it("retains immutable earlier publication versions", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const first = await publishAdminData(repository, publishCommand());
    await commitAdminBatch(repository, adminCommand([{
      type: "save_housing_company",
      value: { ...adminBaselineSnapshot.housingCompany, name: "Version 2" },
      ...metadata(),
    }]));
    await publishAdminData(repository, {
      ...publishCommand(1, 1),
      publishedAt: "2026-07-17T19:00:00+03:00",
    });

    const versionOne = await repository.loadVersion(COMPANY_ID, 1);
    const current = await repository.loadCurrent(COMPANY_ID);
    expect(versionOne).toEqual(first);
    expect(versionOne?.housingCompany.name).not.toBe(current?.housingCompany.name);
  });

  it("blocks stale admin revision and stale publication version", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    await publishAdminData(repository, publishCommand());

    await expect(publishAdminData(
      repository,
      publishCommand(1, 1),
    )).rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });

    await expect(publishAdminData(
      repository,
      publishCommand(0, 0),
    )).rejects.toMatchObject({ code: "PUBLISHED_VERSION_CONFLICT" });
  });

  it("rechecks the admin revision atomically at publication commit", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const staleCandidate = createPublishedDataSnapshot(
      adminBaselineSnapshot,
      publishCommand(),
    );
    await commitAdminBatch(repository, adminCommand([{
      type: "save_housing_company",
      value: { ...adminBaselineSnapshot.housingCompany, name: "Concurrent edit" },
      ...metadata(),
    }]));

    await expect(repository.publish(
      COMPANY_ID,
      0,
      0,
      staleCandidate,
    )).rejects.toMatchObject({ code: "ADMIN_REVISION_CONFLICT" });
    expect(await repository.loadCurrent(COMPANY_ID)).toBeUndefined();
  });

  it("does not create a new version when only an unpublished suggestion changes", async () => {
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    await publishAdminData(repository, publishCommand());
    const draft = suggestedDraft();
    await commitAdminBatch(repository, adminCommand([
      { type: "save_cost_evidence", value: draft.evidence, ...metadata() },
      { type: "save_building_event", value: draft.event, ...metadata() },
    ]));

    await expect(publishAdminData(repository, {
      ...publishCommand(1, 1),
      publishedAt: "2026-07-17T19:00:00+03:00",
    })).rejects.toMatchObject({ code: "NO_PUBLICATION_CHANGES" });
    expect((await repository.loadCurrent(COMPANY_ID))?.publicationVersion)
      .toBe(1);
  });

  it("excludes suggested and cancelled events and includes actual history", () => {
    const draft = suggestedDraft();
    const actual = actualHistory();
    const cancelled = {
      ...draft.event,
      id: "event_cancelled_draft",
      status: "cancelled" as const,
      schedule: draft.event.status === "suggested" ? draft.event.schedule : [],
    };
    const cancelledEvidence: CostEvidence = {
      ...draft.evidence,
      id: "estimate_cancelled_draft",
      eventId: cancelled.id,
    };
    const cancelledWithOwnEvidence: BuildingEvent = {
      ...cancelled,
      schedule: cancelled.schedule?.map((entry) => ({
        ...entry,
        costEvidenceId: cancelledEvidence.id,
      })),
    };
    const admin = applyAdminBatch(adminBaselineSnapshot, adminCommand([
      { type: "save_cost_evidence", value: draft.evidence, ...metadata() },
      { type: "save_building_event", value: draft.event, ...metadata() },
      { type: "save_cost_evidence", value: cancelledEvidence, ...metadata() },
      { type: "save_building_event", value: cancelledWithOwnEvidence, ...metadata() },
      { type: "save_cost_evidence", value: actual.evidence, ...metadata() },
      { type: "save_building_event", value: actual.event, ...metadata() },
    ]));
    const published = createPublishedDataSnapshot(admin, publishCommand(1, 0));
    const view = buildVisitorPublishedView(published);

    expect(view.approvedEvents.some((event) => event.id === draft.event.id))
      .toBe(false);
    expect(view.approvedEvents.some((event) => event.id === cancelled.id))
      .toBe(false);
    expect(view.actualHistory.some((event) => event.id === actual.event.id))
      .toBe(true);
    expect(view.costEvidence.some((item) => item.id === draft.evidence.id))
      .toBe(false);
  });

  it("creates a deterministic fingerprint independent of collection order", () => {
    const reversed = {
      ...adminBaselineSnapshot,
      assets: [...adminBaselineSnapshot.assets].reverse(),
      events: [...adminBaselineSnapshot.events].reverse(),
      costEvidence: [...adminBaselineSnapshot.costEvidence].reverse(),
      financialYears: [...adminBaselineSnapshot.financialYears].reverse(),
    };
    const first = createPublishedDataSnapshot(
      adminBaselineSnapshot,
      publishCommand(),
    );
    const second = createPublishedDataSnapshot(reversed, publishCommand());
    expect(second.contentFingerprint).toBe(first.contentFingerprint);
    expect(second.events).toEqual(first.events);
  });

  it("ignores object key insertion order in the publication fingerprint", () => {
    const company = adminBaselineSnapshot.housingCompany;
    const reorderedCompany = {
      ...(company.operatingBuffer === undefined
        ? {}
        : { operatingBuffer: company.operatingBuffer }),
      ...(company.chargeableAreaM2 === undefined
        ? {}
        : { chargeableAreaM2: company.chargeableAreaM2 }),
      apartmentCount: company.apartmentCount,
      name: company.name,
      id: company.id,
    };
    const reordered = {
      ...adminBaselineSnapshot,
      housingCompany: reorderedCompany,
    };
    const first = createPublishedDataSnapshot(
      adminBaselineSnapshot,
      publishCommand(),
    );
    const second = createPublishedDataSnapshot(reordered, publishCommand());
    expect(second.contentFingerprint).toBe(first.contentFingerprint);
  });

  it("returns defensive copies from publication storage and visitor read model", async () => {
    const snapshot = createPublishedDataSnapshot(
      adminBaselineSnapshot,
      publishCommand(),
    );
    const repository = new InMemoryPublishingRepository(
      [adminBaselineSnapshot],
      [snapshot],
    );
    const loaded = await repository.loadCurrent(COMPANY_ID);
    ((loaded?.assets as unknown) as { name: string }[])[0]!.name = "mutated";
    const loadedAgain = await repository.loadCurrent(COMPANY_ID);
    expect(loadedAgain?.assets[0]?.name).not.toBe("mutated");

    const view = await loadVisitorPublishedView(repository, COMPANY_ID);
    ((view.assets as unknown) as { name: string }[])[0]!.name = "view mutation";
    const viewAgain = await loadVisitorPublishedView(repository, COMPANY_ID);
    expect(viewAgain.assets[0]?.name).not.toBe("view mutation");
  });

  it("rejects tampered publication content", () => {
    const published = createPublishedDataSnapshot(
      adminBaselineSnapshot,
      publishCommand(),
    );
    expect(() => validatePublishedDataSnapshot({
      ...published,
      housingCompany: { ...published.housingCompany, name: "Tampered" },
    })).toThrowError(DomainValidationError);
  });

  it("returns a clear error before the first publication", async () => {
    await expect(loadVisitorPublishedView(
      new InMemoryPublishingRepository(),
      COMPANY_ID,
    )).rejects.toMatchObject({ code: "PUBLISHED_DATA_NOT_FOUND" });
  });

  it("feeds the unchanged projection engine from published data", () => {
    const published = createPublishedDataSnapshot(
      adminBaselineSnapshot,
      publishCommand(),
    );
    const projection = buildProjection({
      assets: published.assets,
      events: published.events,
      costEvidence: published.costEvidence,
      priceLevelConfirmations: published.priceLevelConfirmations,
      horizon: { startYear: 2026, endYear: 2057 },
    });
    expect(projection.scenarios.base.years.length).toBeGreaterThan(0);
    expect(projection.suggestions).toEqual([]);
    expect(projection.cancelled).toEqual([]);
  });
});
