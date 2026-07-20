import type {
  BuildingEvent,
  EventScheduleEntry,
  FutureBuildingEvent,
} from "../domain/types.js";

/**
 * Stable semantic fingerprint used only for optimistic-concurrency checks.
 * Object key order and array order without domain meaning are normalized.
 */
export function eventFingerprint(event: BuildingEvent): string {
  const canonical = canonicalEvent(event);
  return fnv1a(JSON.stringify(canonical));
}

function canonicalEvent(event: BuildingEvent): unknown {
  const base = {
    id: event.id,
    assetId: event.assetId,
    title: event.title,
    type: event.type,
    status: event.status,
    origin: event.origin,
    sourceIds: [...event.sourceIds].sort(),
    observationIds: event.observationIds === undefined
      ? []
      : [...event.observationIds].sort(),
    notes: event.notes ?? null,
  };

  if (event.status === "actual") {
    return {
      ...base,
      actual: {
        year: event.actual.year,
        occurredAt: event.actual.occurredAt ?? null,
        amount: event.actual.amount ?? null,
        quantity: event.actual.quantity ?? null,
        costEvidenceId: event.actual.costEvidenceId,
      },
    };
  }

  return {
    ...base,
    schedule: event.schedule === undefined
      ? []
      : normalizedSchedule(event.schedule),
  };
}

export function approvedEventFromProposal(
  event: FutureBuildingEvent,
): FutureBuildingEvent {
  return {
    id: event.id,
    assetId: event.assetId,
    title: event.title,
    type: event.type,
    status: "approved",
    origin: event.origin,
    sourceIds: [...event.sourceIds].sort(),
    ...(event.observationIds === undefined
      ? {}
      : { observationIds: [...event.observationIds].sort() }),
    ...(event.notes === undefined ? {} : { notes: event.notes }),
    schedule: normalizedSchedule(event.schedule),
  };
}

function normalizedSchedule(
  schedule: readonly EventScheduleEntry[],
): readonly EventScheduleEntry[] {
  return schedule
    .map(normalizedScheduleEntry)
    .sort((a, b) =>
      a.scenario.localeCompare(b.scenario) ||
      a.year - b.year ||
      a.id.localeCompare(b.id)
    );
}

/** Explicit key order prevents JSON property insertion order from affecting hash. */
function normalizedScheduleEntry(
  entry: EventScheduleEntry,
): EventScheduleEntry {
  return {
    id: entry.id,
    scenario: entry.scenario,
    year: entry.year,
    ...(entry.amount === undefined ? {} : { amount: entry.amount }),
    ...(entry.quantity === undefined ? {} : { quantity: entry.quantity }),
    costEvidenceId: entry.costEvidenceId,
    ...(entry.explanation === undefined
      ? {}
      : { explanation: entry.explanation }),
  };
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
