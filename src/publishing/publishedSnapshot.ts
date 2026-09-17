import {
  DomainValidationError,
  FINANCIAL_ACCOUNT_KINDS,
  FINANCIAL_ACCOUNT_NATURES,
  type ActualBuildingEvent,
  type AdminDataSnapshot,
  type Asset,
  type BuildingEvent,
  type CostEvidence,
  type FutureBuildingEvent,
  type PublishAdminDataCommand,
  type PublishedBuildingEvent,
  type PublishedDataSnapshot,
  type PublishedFinancialAccount,
  type PublishedFinancialEntry,
  type PublishedGroupActual,
} from "../domain/types.js";
import { validateAdminDataSnapshot } from "../admin/adminDataValidation.js";
import { withStoredBaselineHashKeys } from "../domain/legacyFieldNames.js";

interface PublishableContent {
  readonly housingCompany: PublishedDataSnapshot["housingCompany"];
  readonly financialYears: PublishedDataSnapshot["financialYears"];
  readonly liquidityBaselines: PublishedDataSnapshot["liquidityBaselines"];
  readonly assets: PublishedDataSnapshot["assets"];
  readonly observations: PublishedDataSnapshot["observations"];
  readonly costEvidence: PublishedDataSnapshot["costEvidence"];
  readonly priceLevelConfirmations: PublishedDataSnapshot["priceLevelConfirmations"];
  readonly events: PublishedDataSnapshot["events"];
  readonly financialAccounts: PublishedDataSnapshot["financialAccounts"];
  readonly financialEntries: PublishedDataSnapshot["financialEntries"];
  readonly groupActuals: PublishedDataSnapshot["groupActuals"];
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
    financialAccounts: [],
    financialEntries: [],
    balanceSheetSnapshots: [],
    groupBudgets: [],
    groupActuals: [],
    maintenanceDocuments: [],
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

  validatePublishedFinancialData(snapshot);

  if (snapshot.contentFingerprint !== fingerprintPublishedContent(snapshot)) {
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

  const financialAccounts = projectFinancialAccounts(admin);
  const publishedCodes = new Set(
    financialAccounts.map((account) => account.accountCode),
  );

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
    financialAccounts,
    financialEntries: admin.financialEntries
      .filter((entry) =>
        publishedCodes.has(entry.accountCode) &&
        typeof entry.actualAmount === "number" &&
        Number.isFinite(entry.actualAmount)
      )
      .map((entry): PublishedFinancialEntry => ({
        accountCode: entry.accountCode,
        year: entry.year,
        actualAmount: entry.actualAmount!,
      }))
      .sort((a, b) =>
        a.accountCode.localeCompare(b.accountCode) || a.year - b.year
      ),
    groupActuals: admin.groupActuals
      .filter((actual) => actual.active)
      .map((actual): PublishedGroupActual => ({
        group: actual.group,
        kind: actual.kind,
        year: actual.year,
        actualAmount: actual.actualAmount,
        active: true,
      }))
      .sort((a, b) =>
        a.kind.localeCompare(b.kind) || a.group.localeCompare(b.group) ||
        a.year - b.year
      ),
  };
}

/**
 * Accounts reduced to the fields the operating-figure calculation reads, and
 * only those that carry an actual worth publishing.
 *
 * `name` is not copied, and the published type declares it `never present`, so
 * writing `admin.financialAccounts` straight through here is a compile error
 * rather than a silent leak of who bills what.
 */
function projectFinancialAccounts(
  admin: AdminDataSnapshot,
): readonly PublishedFinancialAccount[] {
  const reportingCodes = new Set(
    admin.financialEntries
      .filter((entry) =>
        typeof entry.actualAmount === "number" &&
        Number.isFinite(entry.actualAmount)
      )
      .map((entry) => entry.accountCode),
  );
  return admin.financialAccounts
    .filter((account) => reportingCodes.has(account.accountCode))
    .map((account): PublishedFinancialAccount => ({
      accountCode: account.accountCode,
      kind: account.kind,
      group: account.group,
      ...(account.nature === undefined ? {} : { nature: account.nature }),
    }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

/**
 * The published account data validates on its own terms rather than through
 * the synthetic admin snapshot above.
 *
 * It has to: the projection deliberately drops fields validateFinancialAccount
 * requires (`name`), validateFinancialEntry requires (`sourceIds`) and
 * validateGroupActual requires (`id`, `sourceIds`). Feeding it placeholders to
 * satisfy those would produce a validator that can only pass - it would look
 * like it checks three collections while checking nothing about them - and
 * would bake the placeholders permanently into an immutable publication.
 *
 * The `name` check is the projection's own guard, at runtime: a leaked account
 * name is the one mistake here that cannot be undone after publishing.
 */
function validatePublishedFinancialData(snapshot: PublishedDataSnapshot): void {
  // Absent rather than empty is what a publication written before these
  // collections existed looks like. The repository defaults them on load, but
  // this validator is the invariant and runs from several callers
  // (buildVisitorPublishedView among them), so it tolerates the legacy shape
  // itself instead of trusting that someone defaulted it first.
  const accounts = snapshot.financialAccounts ?? [];
  const entries = snapshot.financialEntries ?? [];
  const groupActuals = snapshot.groupActuals ?? [];

  const codes = new Set<string>();
  for (const account of accounts) {
    if (account.accountCode.trim() === "" || codes.has(account.accountCode) ||
        !FINANCIAL_ACCOUNT_KINDS.includes(account.kind) ||
        account.group.trim() === "" ||
        (account.nature !== undefined &&
          !FINANCIAL_ACCOUNT_NATURES.includes(account.nature)) ||
        account.name !== undefined) {
      throw invalidPublished(
        `Published financial account ${account.accountCode || "<empty>"} is invalid`,
      );
    }
    codes.add(account.accountCode);
  }

  const entryKeys = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.accountCode}:${entry.year}`;
    if (!codes.has(entry.accountCode) || !Number.isInteger(entry.year) ||
        entryKeys.has(key) || !Number.isFinite(entry.actualAmount)) {
      throw invalidPublished(`Published financial entry ${key} is invalid`);
    }
    entryKeys.add(key);
  }

  const groupKeys = new Set<string>();
  for (const actual of groupActuals) {
    const key = `${actual.kind}:${actual.group}:${actual.year}`;
    if (actual.group.trim() === "" ||
        !FINANCIAL_ACCOUNT_KINDS.includes(actual.kind) ||
        !Number.isInteger(actual.year) || groupKeys.has(key) ||
        !Number.isFinite(actual.actualAmount) || actual.active !== true) {
      throw invalidPublished(`Published group actual ${key} is invalid`);
    }
    groupKeys.add(key);
  }
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

/**
 * Collections added to PublishableContent after publications already existed.
 * See fingerprintPublishableContent.
 */
const ADDITIVE_CONTENT_KEYS = [
  "financialAccounts",
  "financialEntries",
  "groupActuals",
] as const;

const PUBLISHABLE_CONTENT_KEYS = [
  "housingCompany",
  "financialYears",
  "liquidityBaselines",
  "assets",
  "observations",
  "costEvidence",
  "priceLevelConfirmations",
  "events",
  "financialAccounts",
  "financialEntries",
  "groupActuals",
] as const satisfies readonly (keyof PublishableContent)[];

/**
 * The fingerprint a stored publication row was written with, computed from
 * the raw parsed payload before any read-side normalisation. This is how a
 * repository verifies a row against its content_fingerprint column: the
 * row's own shape is hashed, whichever generation wrote it, and the
 * liquidity baselines are hashed under the keys that generation used for
 * the hash (withStoredBaselineHashKeys). After verification the loaded
 * snapshot is normalised and re-fingerprinted over the current shape
 * (fingerprintPublishedContent), so every in-memory recomputation agrees.
 */
export function fingerprintStoredPublicationPayload(
  payload: Record<string, unknown>,
): string {
  const content: Record<string, unknown> = {};
  for (const key of PUBLISHABLE_CONTENT_KEYS) content[key] = payload[key];
  const baselines = Array.isArray(content.liquidityBaselines)
    ? (content.liquidityBaselines as Record<string, unknown>[])
    : [];
  content.liquidityBaselines = baselines.map(withStoredBaselineHashKeys);
  return fingerprintPublishableContent(content as unknown as PublishableContent);
}

/** The current-shape fingerprint of a loaded publication's content. */
export function fingerprintPublishedContent(
  snapshot: PublishedDataSnapshot,
): string {
  return fingerprintPublishableContent(publishableContentOf(snapshot));
}

function publishableContentOf(snapshot: PublishedDataSnapshot): PublishableContent {
  return {
    housingCompany: snapshot.housingCompany,
    financialYears: snapshot.financialYears,
    liquidityBaselines: snapshot.liquidityBaselines,
    assets: snapshot.assets,
    observations: snapshot.observations,
    costEvidence: snapshot.costEvidence,
    priceLevelConfirmations: snapshot.priceLevelConfirmations,
    events: snapshot.events,
    financialAccounts: snapshot.financialAccounts,
    financialEntries: snapshot.financialEntries,
    groupActuals: snapshot.groupActuals,
  };
}

function fingerprintPublishableContent(content: PublishableContent): string {
  const canonical = JSON.stringify(
    sortObjectKeysRecursively(withoutEmptyAdditiveKeys(content)),
  );
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const character of canonical) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

/**
 * Drops the additive collections when they are empty, so that content which
 * carries no account data fingerprints exactly as it did before those keys
 * existed.
 *
 * THIS IS LOAD-BEARING, and measured rather than assumed. The fingerprint is
 * recomputed and compared on every read (validatePublishedDataSnapshot), so a
 * change in how content canonicalises does not quietly alter future hashes -
 * it invalidates every publication already stored. JSON.stringify omits a key
 * whose value is `undefined` but serialises `[]`, so defaulting a missing
 * collection to an empty array before hashing would have changed the hash of
 * every publication written before this change and made all of them
 * unloadable, taking the public overview and every visitor session with them:
 *
 *   {"events":[],"housingCompany":{...}}                    6ba51ee380fcbe85
 *   {"events":[],"financialAccounts":[],"housingCompany":…} a348830ebf37eb38
 *
 * Omitting the empty case makes absent and empty hash alike, which also keeps
 * the admin dashboard honest: without it, a company with no account data would
 * report publishable changes forever, because its fingerprint could never
 * match a publication written before the keys existed.
 *
 * Only these keys get the rule. Applying it to every empty collection would
 * change the hash of publications that legitimately stored `"observations":[]`,
 * which is the same breakage from the other direction.
 */
function withoutEmptyAdditiveKeys(content: PublishableContent): unknown {
  const result: Record<string, unknown> = { ...content };
  for (const key of ADDITIVE_CONTENT_KEYS) {
    const value = content[key] as readonly unknown[] | undefined;
    if (value === undefined || value.length === 0) delete result[key];
  }
  return result;
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
