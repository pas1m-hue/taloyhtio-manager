import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  type AdminDataBatchCommand,
  type BuildingEvent,
  type CostEvidence,
  type PublishAdminDataCommand,
  type PublishedDataSnapshot,
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

  it("carries the maintenance-plan coverage to the visitor side", async () => {
    // The coverage rides along inside housingCompany, so no publishing-pipeline
    // field of its own is needed - but it must actually arrive, and changing
    // only the coverage must count as a publishable content change.
    const repository = new InMemoryPublishingRepository([adminBaselineSnapshot]);
    const first = await publishAdminData(repository, publishCommand());
    expect(first.housingCompany.maintenancePlanCoverageThroughYear)
      .toBeUndefined();

    await commitAdminBatch(repository, adminCommand([{
      type: "save_housing_company",
      value: {
        ...adminBaselineSnapshot.housingCompany,
        maintenancePlanCoverageThroughYear: 2030,
      },
      ...metadata(),
    }]));
    const second = await publishAdminData(repository, {
      ...publishCommand(1, 1),
      publishedAt: "2026-07-17T19:00:00+03:00",
    });

    expect(second.housingCompany.maintenancePlanCoverageThroughYear).toBe(2030);
    expect(second.contentFingerprint).not.toBe(first.contentFingerprint);
    validatePublishedDataSnapshot(second);
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

describe("account data reaches a publication as a projection, not wholesale", () => {
  const ACCOUNTS = [
    {
      accountCode: "4010",
      name: "Isännöinti, Kiinteistöhallinta Oy",
      kind: "expense" as const,
      group: "Hallinto",
      nature: "maintenance" as const,
      controllability: "fixed" as const,
      active: true,
    },
    {
      accountCode: "4600",
      name: "Korjaukset",
      kind: "expense" as const,
      group: "KORJAUKSET",
      nature: "repair" as const,
      active: true,
    },
    {
      accountCode: "9999",
      name: "Käyttämätön tili",
      kind: "expense" as const,
      group: "Hallinto",
      active: true,
    },
  ];
  const ENTRIES = [
    {
      accountCode: "4010",
      year: 2025,
      actualAmount: -13_100.20,
      sourceIds: ["tilinpaatos_2025"],
      notes: "Sisältää kertaluonteisen laskutuslisän.",
    },
    {
      accountCode: "4600",
      year: 2025,
      actualAmount: -3_881.55,
      sourceIds: ["tilinpaatos_2025"],
    },
    // Budget-only: nothing the published calculation reads.
    {
      accountCode: "4010",
      year: 2026,
      budgetAmount: -13_500,
      sourceIds: ["talousarvio_2026"],
    },
  ];
  const GROUP_ACTUALS = [
    {
      id: "ga_income_hoitovastikkeet_2023",
      group: "Hoitovastikkeet",
      kind: "income" as const,
      year: 2023,
      actualAmount: 36_237.38,
      active: true,
      sourceIds: ["tilinpaatos_2023"],
    },
    {
      id: "ga_income_hoitovastikkeet_2022",
      group: "Hoitovastikkeet",
      kind: "income" as const,
      year: 2022,
      actualAmount: 30_000,
      active: false,
      sourceIds: ["tilinpaatos_2022"],
    },
  ];

  function adminWithAccounts() {
    return {
      ...adminBaselineSnapshot,
      financialAccounts: ACCOUNTS,
      financialEntries: ENTRIES,
      groupActuals: GROUP_ACTUALS,
    };
  }

  it("publishes the fields the forecast reads and drops the rest", () => {
    const snapshot = createPublishedDataSnapshot(adminWithAccounts(), publishCommand());

    expect(snapshot.financialAccounts).toEqual([
      { accountCode: "4010", kind: "expense", group: "Hallinto", nature: "maintenance" },
      { accountCode: "4600", kind: "expense", group: "KORJAUKSET", nature: "repair" },
    ]);
  });

  it("never carries an account name into an immutable publication", () => {
    // The one mistake here that cannot be undone: a publication cannot be
    // edited, so a leaked name is published for as long as the publication
    // exists. Serialised and searched rather than checked key by key, so a
    // name smuggled in through any nesting fails this too.
    const snapshot = createPublishedDataSnapshot(adminWithAccounts(), publishCommand());

    expect(JSON.stringify(snapshot)).not.toContain("Kiinteistöhallinta");
    expect(JSON.stringify(snapshot)).not.toContain("laskutuslisän");
    expect(JSON.stringify(snapshot.financialAccounts)).not.toContain("name");
  });

  it("drops an account nothing reports an actual for", () => {
    const snapshot = createPublishedDataSnapshot(adminWithAccounts(), publishCommand());

    expect(snapshot.financialAccounts.map((account) => account.accountCode))
      .not.toContain("9999");
  });

  it("publishes only entries carrying an actual, without their sources or notes", () => {
    const snapshot = createPublishedDataSnapshot(adminWithAccounts(), publishCommand());

    expect(snapshot.financialEntries).toEqual([
      { accountCode: "4010", year: 2025, actualAmount: -13_100.20 },
      { accountCode: "4600", year: 2025, actualAmount: -3_881.55 },
    ]);
  });

  it("publishes only active group actuals, without their ids or sources", () => {
    const snapshot = createPublishedDataSnapshot(adminWithAccounts(), publishCommand());

    expect(snapshot.groupActuals).toEqual([
      {
        group: "Hoitovastikkeet",
        kind: "income",
        year: 2023,
        actualAmount: 36_237.38,
        active: true,
      },
    ]);
  });

  it("rejects a snapshot whose projection leaked an account name", () => {
    // The compile-time guard is PublishedFinancialAccount declaring `name`
    // never present; this is the runtime one, for a payload arriving from
    // storage rather than from the projection.
    const snapshot = createPublishedDataSnapshot(adminWithAccounts(), publishCommand());
    const leaked = {
      ...snapshot,
      financialAccounts: [
        { ...snapshot.financialAccounts[0], name: "Isännöinti, Kiinteistöhallinta Oy" },
        ...snapshot.financialAccounts.slice(1),
      ],
    } as unknown as PublishedDataSnapshot;

    expect(() => validatePublishedDataSnapshot(leaked))
      .toThrow(/Published financial account 4010 is invalid/);
  });

  it("keeps the account data out of the visitor view entirely", () => {
    // buildVisitorPublishedView is what the unauthenticated public overview
    // and every visitor session return. It is an allowlist, and after this
    // change it is the only thing standing between the published account data
    // and an anonymous caller — so this test exists to fail the day someone
    // spreads the snapshot into it.
    const snapshot = createPublishedDataSnapshot(adminWithAccounts(), publishCommand());

    const view = buildVisitorPublishedView(snapshot);

    expect(view).not.toHaveProperty("financialAccounts");
    expect(view).not.toHaveProperty("financialEntries");
    expect(view).not.toHaveProperty("groupActuals");
    expect(JSON.stringify(view)).not.toContain("KORJAUKSET");
  });

  it("loads a publication written before the account collections existed", () => {
    // A row stored by the previous code has no such JSON keys. Both halves of
    // validatePublishedDataSnapshot must survive that: the synthetic-admin
    // validation, and the fingerprint comparison — the stored hash was
    // computed without these keys, so the recomputed one has to agree.
    const snapshot = createPublishedDataSnapshot(adminBaselineSnapshot, publishCommand());
    const legacy = { ...snapshot } as Record<string, unknown>;
    delete legacy["financialAccounts"];
    delete legacy["financialEntries"];
    delete legacy["groupActuals"];

    expect(() => validatePublishedDataSnapshot(legacy as unknown as PublishedDataSnapshot))
      .not.toThrow();
  });

  it("fingerprints an empty projection exactly as the absent one", () => {
    // The compatibility rule stated directly: a company with no account data
    // must fingerprint the same before and after the keys existed, or the
    // admin dashboard reports publishable changes that never clear.
    const withEmpty = createPublishedDataSnapshot(adminBaselineSnapshot, publishCommand());
    const legacy = { ...withEmpty } as Record<string, unknown>;
    delete legacy["financialAccounts"];
    delete legacy["financialEntries"];
    delete legacy["groupActuals"];

    expect(withEmpty.financialAccounts).toEqual([]);
    expect(() => validatePublishedDataSnapshot(legacy as unknown as PublishedDataSnapshot))
      .not.toThrow();
    expect((legacy as unknown as PublishedDataSnapshot).contentFingerprint)
      .toBe(withEmpty.contentFingerprint);
  });

  it("makes account data part of what publishing considers changed", () => {
    const withoutAccounts = createPublishedDataSnapshot(
      adminBaselineSnapshot,
      publishCommand(),
    );
    const withAccounts = createPublishedDataSnapshot(
      adminWithAccounts(),
      publishCommand(),
    );

    expect(withAccounts.contentFingerprint)
      .not.toBe(withoutAccounts.contentFingerprint);
  });
});
