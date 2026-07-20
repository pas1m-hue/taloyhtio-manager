import {
  DomainValidationError,
  type ActualBuildingEvent,
  type AdminDataSnapshot,
  type Asset,
  type BuildingEvent,
  type CostEvidence,
  type FutureBuildingEvent,
  type PublishAdminDataCommand,
  type PublishedBuildingEvent,
  type PublishedDataSnapshot,
} from "../domain/types.js";
import { validateAdminDataSnapshot } from "../admin/adminDataValidation.js";

interface PublishableContent {
  readonly housingCompany: PublishedDataSnapshot["housingCompany"];
  readonly financialYears: PublishedDataSnapshot["financialYears"];
  readonly liquidityBaselines: PublishedDataSnapshot["liquidityBaselines"];
  readonly assets: PublishedDataSnapshot["assets"];
  readonly observations: PublishedDataSnapshot["observations"];
  readonly costEvidence: PublishedDataSnapshot["costEvidence"];
  readonly priceLevelConfirmations: PublishedDataSnapshot["priceLevelConfirmations"];
  readonly events: PublishedDataSnapshot["events"];
}

/**
 * Creates one immutable public version from one exact admin revision.
 * Suggested and cancelled events are intentionally excluded from the public
 * snapshot; admin audit data is never copied into it.
 */
export function createPublishedDataSnapshot(
  admin: AdminDataSnapshot,
  command: PublishAdminDataCommand,
): PublishedDataSnapshot {
  validateAdminDataSnapshot(admin);
  validatePublishCommand(admin, command);

  const content = buildPublishableContent(admin);
  const snapshot: PublishedDataSnapshot = {
    companyId: admin.companyId,
    publicationVersion: command.expectedPublishedVersion + 1,
    sourceAdminRevision: admin.revision,
    contentFingerprint: fingerprintPublishableContent(content),
    ...content,
    publishedAt: command.publishedAt,
    publishedBy: command.publishedBy,
    sourceIds: [...command.sourceIds].sort(),
    explanation: command.explanation,
  };
  validatePublishedDataSnapshot(snapshot);
  return clone(snapshot);
}

export function validatePublishedDataSnapshot(
  snapshot: PublishedDataSnapshot,
): void {
  if (snapshot.companyId.trim() === "" ||
      !Number.isInteger(snapshot.publicationVersion) ||
      snapshot.publicationVersion <= 0 ||
      !Number.isInteger(snapshot.sourceAdminRevision) ||
      snapshot.sourceAdminRevision < 0 ||
      !validDate(snapshot.publishedAt) ||
      snapshot.publishedBy.trim() === "" ||
      snapshot.sourceIds.length === 0 ||
      snapshot.sourceIds.some((item) => item.trim() === "") ||
      snapshot.explanation.trim() === "") {
    throw invalidPublished("Published snapshot metadata is invalid");
  }
  if (snapshot.events.some((event) =>
    event.status !== "approved" && event.status !== "actual"
  )) {
    throw invalidPublished(
      "Published snapshot contains a suggested or cancelled event",
    );
  }

  const syntheticAdmin: AdminDataSnapshot = {
    companyId: snapshot.companyId,
    revision: snapshot.sourceAdminRevision,
    housingCompany: clone(snapshot.housingCompany),
    financialYears: clone(snapshot.financialYears),
    liquidityBaselines: clone(snapshot.liquidityBaselines),
    assets: clone(snapshot.assets),
    observations: clone(snapshot.observations),
    costEvidence: clone(snapshot.costEvidence),
    priceLevelConfirmations: clone(snapshot.priceLevelConfirmations),
    events: clone(snapshot.events),
    auditTrail: [],
    updatedAt: snapshot.publishedAt,
    updatedBy: snapshot.publishedBy,
  };
  try {
    validateAdminDataSnapshot(syntheticAdmin);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw invalidPublished(error.message);
    }
    throw error;
  }

  const expectedFingerprint = fingerprintPublishableContent({
    housingCompany: snapshot.housingCompany,
    financialYears: snapshot.financialYears,
    liquidityBaselines: snapshot.liquidityBaselines,
    assets: snapshot.assets,
    observations: snapshot.observations,
    costEvidence: snapshot.costEvidence,
    priceLevelConfirmations: snapshot.priceLevelConfirmations,
    events: snapshot.events,
  });
  if (snapshot.contentFingerprint !== expectedFingerprint) {
    throw invalidPublished("Published snapshot fingerprint does not match content");
  }
}

export function fingerprintAdminPublishableContent(
  admin: AdminDataSnapshot,
): string {
  return fingerprintPublishableContent(buildPublishableContent(admin));
}

function buildPublishableContent(admin: AdminDataSnapshot): PublishableContent {
  const events = admin.events
    .filter(isPublishedEvent)
    .map(normalizePublishedEvent)
    .sort(byId);

  const eventAssetIds = new Set(events.map((event) => event.assetId));
  const assets = admin.assets
    .filter((asset) => asset.active || eventAssetIds.has(asset.id))
    .map(normalizeAsset)
    .sort(byId);
  const assetIds = new Set(assets.map((asset) => asset.id));

  const observations = admin.observations
    .filter((observation) => assetIds.has(observation.assetId))
    .map((observation) => ({
      ...clone(observation),
      sourceIds: [...observation.sourceIds].sort(),
    }))
    .sort(byId);

  const evidenceIds = collectEvidenceIds(events);
  const costEvidence = admin.costEvidence
    .filter((evidence) => evidenceIds.has(evidence.id))
    .map(normalizeEvidence)
    .sort(byId);
  const includedEvidenceIds = new Set(costEvidence.map((item) => item.id));

  return {
    housingCompany: clone(admin.housingCompany),
    financialYears: [...admin.financialYears]
      .sort((a, b) => a.year - b.year)
      .map((item) => ({ ...clone(item), sourceIds: [...item.sourceIds].sort() })),
    liquidityBaselines: [...admin.liquidityBaselines]
      .sort(byId)
      .map((item) => ({ ...clone(item), sourceIds: [...item.sourceIds].sort() })),
    assets,
    observations,
    costEvidence,
    priceLevelConfirmations: admin.priceLevelConfirmations
      .filter((confirmation) =>
        includedEvidenceIds.has(confirmation.costEvidenceId)
      )
      .map(clone)
      .sort((a, b) => a.costEvidenceId.localeCompare(b.costEvidenceId)),
    events,
  };
}

function validatePublishCommand(
  admin: AdminDataSnapshot,
  command: PublishAdminDataCommand,
): void {
  if (command.companyId !== admin.companyId ||
      command.expectedAdminRevision !== admin.revision) {
    throw new DomainValidationError(
      "ADMIN_REVISION_CONFLICT",
      `Cannot publish ${command.companyId}; expected admin revision ` +
        `${command.expectedAdminRevision}, current revision is ${admin.revision}.`,
    );
  }
  if (!Number.isInteger(command.expectedPublishedVersion) ||
      command.expectedPublishedVersion < 0 || !validDate(command.publishedAt) ||
      command.publishedBy.trim() === "" || command.sourceIds.length === 0 ||
      command.sourceIds.some((item) => item.trim() === "") ||
      command.explanation.trim() === "") {
    throw invalidPublished("Publication command metadata is invalid");
  }
}

function isPublishedEvent(event: BuildingEvent): event is PublishedBuildingEvent {
  return event.status === "approved" || event.status === "actual";
}

function normalizePublishedEvent(
  event: PublishedBuildingEvent,
): PublishedBuildingEvent {
  const base = {
    id: event.id,
    assetId: event.assetId,
    title: event.title,
    type: event.type,
    origin: event.origin,
    sourceIds: [...event.sourceIds].sort(),
    ...(event.observationIds === undefined
      ? {}
      : { observationIds: [...event.observationIds].sort() }),
    ...(event.notes === undefined ? {} : { notes: event.notes }),
  };
  if (event.status === "actual") {
    const actual: ActualBuildingEvent = {
      ...base,
      status: "actual",
      actual: clone(event.actual),
    };
    return actual;
  }
  const future: Omit<FutureBuildingEvent, "status"> & { readonly status: "approved" } = {
    ...base,
    status: "approved",
    schedule: event.schedule
      .map((entry) => ({
        id: entry.id,
        scenario: entry.scenario,
        year: entry.year,
        ...(entry.amount === undefined ? {} : { amount: entry.amount }),
        ...(entry.quantity === undefined ? {} : { quantity: entry.quantity }),
        costEvidenceId: entry.costEvidenceId,
        ...(entry.explanation === undefined
          ? {}
          : { explanation: entry.explanation }),
      }))
      .sort(byId),
  };
  return future;
}

function normalizeAsset(asset: Asset): Asset {
  return {
    ...clone(asset),
    sourceIds: [...asset.sourceIds].sort(),
  };
}

function normalizeEvidence(evidence: CostEvidence): CostEvidence {
  return clone(evidence);
}

function collectEvidenceIds(
  events: readonly PublishedBuildingEvent[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.status === "actual") {
      ids.add(event.actual.costEvidenceId);
    } else {
      event.schedule.forEach((entry) => ids.add(entry.costEvidenceId));
    }
  }
  return ids;
}

function fingerprintPublishableContent(content: PublishableContent): string {
  const canonical = JSON.stringify(sortObjectKeysRecursively(content));
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const character of canonical) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function sortObjectKeysRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeysRecursively);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortObjectKeysRecursively(nested)]),
    );
  }
  return value;
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function invalidPublished(message: string): DomainValidationError {
  return new DomainValidationError(
    "INVALID_PUBLISHED_DATA",
    `${message}.`,
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
