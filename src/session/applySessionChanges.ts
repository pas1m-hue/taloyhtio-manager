import {
  PROJECTION_PRICE_LEVEL_YEAR,
  DomainValidationError,
  type CostEvidence,
  type EffectiveSessionData,
  type EventScheduleEntry,
  type BuildingEvent,
  type FutureBuildingEvent,
  type PublishedDataSnapshot,
  type SessionEventOverride,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import { validatePublishedDataSnapshot } from "../publishing/publishedSnapshot.js";
import { validateVisitorSessionWorkspace } from "./sessionWorkspace.js";

export function buildEffectiveSessionData(
  publication: PublishedDataSnapshot,
  workspace: VisitorSessionWorkspace,
): EffectiveSessionData {
  validatePublishedDataSnapshot(publication);
  validateVisitorSessionWorkspace(workspace);
  validatePublicationBinding(publication, workspace);

  const assetsById = new Map(publication.assets.map((asset) => [asset.id, asset]));
  type ApprovedPublishedEvent = Omit<FutureBuildingEvent, "status"> & { readonly status: "approved" };
  const approvedById = new Map<string, ApprovedPublishedEvent>();
  for (const event of publication.events) {
    if (event.status === "approved") approvedById.set(event.id, event);
  }
  const overridesByTarget = new Map<string, SessionEventOverride>();

  for (const override of workspace.eventOverrides) {
    const event = approvedById.get(override.eventId);
    if (event === undefined) {
      throw invalidSession(
        `Override ${override.id} targets missing approved event ${override.eventId}`,
      );
    }
    if (!event.schedule.some((entry) => entry.id === override.scheduleEntryId)) {
      throw invalidSession(
        `Override ${override.id} targets missing schedule row ` +
          `${override.eventId}/${override.scheduleEntryId}`,
      );
    }
    overridesByTarget.set(targetKey(override.eventId, override.scheduleEntryId), override);
  }

  const syntheticEvidence: CostEvidence[] = [];
  const effectiveEvents: BuildingEvent[] = [];
  for (const event of publication.events) {
    if (event.status === "actual") {
      effectiveEvents.push(clone(event));
      continue;
    }
    const schedule: EventScheduleEntry[] = [];
    for (const entry of event.schedule) {
      const override = overridesByTarget.get(targetKey(event.id, entry.id));
      if (override === undefined) {
        schedule.push(clone(entry));
      } else if (override.excluded !== true) {
        schedule.push(
          applyOverride(workspace, event, entry, override, syntheticEvidence),
        );
      }
    }
    if (schedule.length > 0) {
      effectiveEvents.push({ ...clone(event), schedule });
    }
  }

  const publishedEventIds = new Set(publication.events.map((event) => event.id));
  for (const custom of workspace.customEvents) {
    const asset = assetsById.get(custom.assetId);
    if (asset === undefined || !asset.active) {
      throw invalidSession(
        `Custom event ${custom.id} references missing or inactive asset ${custom.assetId}`,
      );
    }
    const eventId = customEventId(workspace.sessionId, custom.id);
    if (publishedEventIds.has(eventId)) {
      throw invalidSession(`Custom event ${custom.id} conflicts with a published event id`);
    }
    const schedule: EventScheduleEntry[] = custom.schedule.map((entry) => {
      const evidenceId = customEvidenceId(workspace.sessionId, custom.id, entry.id);
      syntheticEvidence.push({
        id: evidenceId,
        assetId: custom.assetId,
        eventId,
        status: entry.amount === undefined ? "data_gap" : "estimate",
        ...(entry.amount === undefined ? {} : { amount: entry.amount }),
        unit: "EUR/session-scenario",
        ...(entry.quantity === undefined ? {} : { quantity: entry.quantity }),
        priceLevelYear: PROJECTION_PRICE_LEVEL_YEAR,
        sourceId: sessionSourceId(workspace.sessionId),
        notes: "Visitor session custom event; never persisted to admin data.",
      });
      return {
        id: customScheduleId(workspace.sessionId, custom.id, entry.id),
        scenario: entry.scenario,
        year: entry.year,
        ...(entry.amount === undefined ? {} : { amount: entry.amount }),
        ...(entry.quantity === undefined ? {} : { quantity: entry.quantity }),
        costEvidenceId: evidenceId,
        explanation: entry.explanation ??
          "Visitor session custom row; no persistent data was changed.",
      };
    });
    effectiveEvents.push({
      id: eventId,
      assetId: custom.assetId,
      title: custom.title,
      type: custom.type,
      origin: "manual",
      sourceIds: [sessionSourceId(workspace.sessionId)],
      ...(custom.notes === undefined ? {} : { notes: custom.notes }),
      status: "approved",
      schedule,
    });
  }

  return clone({
    assets: publication.assets,
    events: effectiveEvents.sort(byId),
    costEvidence: [...publication.costEvidence.map(clone), ...syntheticEvidence]
      .sort(byId),
    priceLevelConfirmations: publication.priceLevelConfirmations,
  });
}

function applyOverride(
  workspace: VisitorSessionWorkspace,
  event: FutureBuildingEvent,
  entry: EventScheduleEntry,
  override: SessionEventOverride,
  syntheticEvidence: CostEvidence[],
): EventScheduleEntry {
  const hasAmount = Object.hasOwn(override, "amount");
  const hasQuantity = Object.hasOwn(override, "quantity");
  let costEvidenceId = entry.costEvidenceId;
  let amount = entry.amount;
  if (hasAmount) {
    const evidenceId = overrideEvidenceId(workspace.sessionId, override.id);
    const overriddenAmount = override.amount;
    const evidenceQuantity = effectiveQuantity(entry, override);
    syntheticEvidence.push({
      id: evidenceId,
      assetId: event.assetId,
      eventId: event.id,
      status: overriddenAmount === null ? "data_gap" : "estimate",
      ...(overriddenAmount === null ? {} : { amount: overriddenAmount }),
      unit: "EUR/session-scenario",
      ...(evidenceQuantity === undefined ? {} : { quantity: evidenceQuantity }),
      priceLevelYear: PROJECTION_PRICE_LEVEL_YEAR,
      sourceId: sessionSourceId(workspace.sessionId),
      notes: `Visitor session override ${override.id}; never persisted to admin data.`,
    });
    costEvidenceId = evidenceId;
    amount = overriddenAmount === null ? undefined : overriddenAmount;
  }

  const quantity = hasQuantity
    ? override.quantity === null ? undefined : override.quantity
    : entry.quantity;

  return {
    id: entry.id,
    scenario: entry.scenario,
    year: override.year ?? entry.year,
    ...(amount === undefined ? {} : { amount }),
    ...(quantity === undefined ? {} : { quantity }),
    costEvidenceId,
    explanation: override.explanation ?? entry.explanation ??
      "Visitor session override; no persistent data was changed.",
  };
}

function effectiveQuantity(
  entry: EventScheduleEntry,
  override: SessionEventOverride,
): number | undefined {
  if (!Object.hasOwn(override, "quantity")) return entry.quantity;
  return override.quantity === null ? undefined : override.quantity;
}

function validatePublicationBinding(
  publication: PublishedDataSnapshot,
  workspace: VisitorSessionWorkspace,
): void {
  if (workspace.companyId !== publication.companyId ||
      workspace.publicationVersion !== publication.publicationVersion ||
      workspace.publicationFingerprint !== publication.contentFingerprint) {
    throw new DomainValidationError(
      "SESSION_PUBLICATION_MISMATCH",
      `Session ${workspace.sessionId} is not bound to publication ` +
        `${publication.companyId}/${publication.publicationVersion}.`,
    );
  }
}

function targetKey(eventId: string, entryId: string): string {
  return `${eventId}\u0000${entryId}`;
}

function sessionSourceId(sessionId: string): string {
  return `visitor_session:${segment(sessionId)}`;
}

function customEventId(sessionId: string, customId: string): string {
  return `session:${segment(sessionId)}:custom-event:${segment(customId)}`;
}

function customScheduleId(
  sessionId: string,
  customId: string,
  entryId: string,
): string {
  return `session:${segment(sessionId)}:custom-row:${segment(customId)}:${segment(entryId)}`;
}

function customEvidenceId(
  sessionId: string,
  customId: string,
  entryId: string,
): string {
  return `session:${segment(sessionId)}:custom-evidence:${segment(customId)}:${segment(entryId)}`;
}

function overrideEvidenceId(sessionId: string, overrideId: string): string {
  return `session:${segment(sessionId)}:override-evidence:${segment(overrideId)}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function invalidSession(message: string): DomainValidationError {
  return new DomainValidationError("INVALID_SESSION_DATA", `${message}.`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
