import type {
  BuildingEvent,
  CancelledBuildingEvent,
  EventScheduleEntry,
  FutureBuildingEvent,
} from "../domain/types.js";

/**
 * Produces a structurally independent audit snapshot. TypeScript readonly
 * modifiers do not prevent runtime aliasing, so audit records must never share
 * nested object or array references with the active event base.
 */
export function cloneAuditSnapshot(event: BuildingEvent): BuildingEvent {
  const base = {
    id: event.id,
    assetId: event.assetId,
    title: event.title,
    type: event.type,
    status: event.status,
    origin: event.origin,
    sourceIds: [...event.sourceIds],
    ...(event.observationIds === undefined
      ? {}
      : { observationIds: [...event.observationIds] }),
    ...(event.notes === undefined ? {} : { notes: event.notes }),
  };

  if (event.status === "actual") {
    return {
      ...base,
      status: "actual",
      actual: { ...event.actual },
    };
  }

  if (event.status === "cancelled") {
    const cancelled: CancelledBuildingEvent = {
      ...base,
      status: "cancelled",
      ...(event.schedule === undefined
        ? {}
        : { schedule: cloneSchedule(event.schedule) }),
    };
    return cancelled;
  }

  const future: FutureBuildingEvent = {
    ...base,
    status: event.status,
    schedule: cloneSchedule(event.schedule),
  };
  return future;
}

function cloneSchedule(
  schedule: readonly EventScheduleEntry[],
): readonly EventScheduleEntry[] {
  return schedule.map((entry) => ({ ...entry }));
}
