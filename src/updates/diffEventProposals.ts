import {
  DomainValidationError,
  type BuildingEvent,
  type EventChangeCandidate,
  type EventChangeProposal,
  type EventProposalDiffResult,
  type FutureBuildingEvent,
} from "../domain/types.js";
import {
  approvedEventFromProposal,
  eventFingerprint,
} from "./eventFingerprint.js";
import {
  requireSuggestedEvent,
  validateProposalSourcesOnEvent,
} from "./eventChangeValidation.js";

export interface DiffEventProposalsInput {
  readonly currentEvents: readonly BuildingEvent[];
  readonly candidates: readonly EventChangeCandidate[];
}

/**
 * Converts reviewed manual/import observations into pending proposals without mutating
 * approved event data. Update/cancel proposals capture a target fingerprint.
 */
export function diffEventProposals(
  input: DiffEventProposalsInput,
): EventProposalDiffResult {
  const currentById = uniqueEvents(input.currentEvents);
  const seenCandidateIds = new Set<string>();
  const proposals: EventChangeProposal[] = [];
  const unchangedCandidateIds: string[] = [];

  for (const candidate of [...input.candidates].sort(byId)) {
    if (seenCandidateIds.has(candidate.id)) {
      throw new DomainValidationError(
        "DUPLICATE_CHANGE_PROPOSAL_ID",
        `Change candidate id ${candidate.id} occurs more than once.`,
      );
    }
    seenCandidateIds.add(candidate.id);
    validateCommonCandidate(candidate);

    if (candidate.changeType === "add") {
      validateAddCandidate(candidate, currentById);
      proposals.push({
        ...candidate,
        sourceIds: [...candidate.sourceIds].sort(),
        status: "pending",
        proposedEvent: cloneFuture(candidate.proposedEvent as FutureBuildingEvent),
      });
      continue;
    }

    const target = requireApprovedFutureTarget(candidate.targetEventId, currentById);
    if (candidate.changeType === "cancel") {
      if (candidate.proposedEvent !== undefined) {
        throw invalid(candidate.id, "cancel must not contain proposedEvent");
      }
      proposals.push({
        ...candidate,
        sourceIds: [...candidate.sourceIds].sort(),
        status: "pending",
        targetEventId: target.id,
        expectedTargetFingerprint: eventFingerprint(target),
      });
      continue;
    }

    const proposed = requireSuggestedEvent(candidate.proposedEvent, candidate.id);
    validateProposalSourcesOnEvent(candidate.sourceIds, proposed, candidate.id);
    if (candidate.targetEventId !== proposed.id) {
      throw invalid(
        candidate.id,
        `update proposedEvent.id ${proposed.id} must equal targetEventId ` +
          `${candidate.targetEventId ?? "none"}`,
      );
    }
    const approvedProposed = approvedEventFromProposal(proposed);
    if (eventFingerprint(approvedProposed) === eventFingerprint(target)) {
      unchangedCandidateIds.push(candidate.id);
      continue;
    }
    proposals.push({
      ...candidate,
      sourceIds: [...candidate.sourceIds].sort(),
      status: "pending",
      targetEventId: target.id,
      expectedTargetFingerprint: eventFingerprint(target),
      proposedEvent: cloneFuture(proposed),
    });
  }

  return {
    proposals: proposals.sort(byId),
    unchangedCandidateIds: unchangedCandidateIds.sort(),
  };
}

function validateCommonCandidate(candidate: EventChangeCandidate): void {
  if (candidate.id.trim() === "" || candidate.explanation.trim() === "" ||
      candidate.createdAt.trim() === "") {
    throw invalid(candidate.id, "id, explanation, and createdAt are required");
  }
  if (candidate.sourceIds.length === 0 ||
      candidate.sourceIds.some((source) => source.trim() === "")) {
    throw new DomainValidationError(
      "MISSING_CHANGE_SOURCE",
      `Change candidate ${candidate.id} requires at least one named source.`,
    );
  }
}

function validateAddCandidate(
  candidate: EventChangeCandidate,
  currentById: ReadonlyMap<string, BuildingEvent>,
): void {
  if (candidate.targetEventId !== undefined) {
    throw invalid(candidate.id, "add must not contain targetEventId");
  }
  const proposed = requireSuggestedEvent(candidate.proposedEvent, candidate.id);
  validateProposalSourcesOnEvent(candidate.sourceIds, proposed, candidate.id);
  if (currentById.has(proposed.id)) {
    throw new DomainValidationError(
      "CHANGE_PROPOSAL_CONFLICT",
      `Add proposal ${candidate.id} would duplicate event id ${proposed.id}.`,
    );
  }
}

function requireApprovedFutureTarget(
  targetEventId: string | undefined,
  currentById: ReadonlyMap<string, BuildingEvent>,
): FutureBuildingEvent {
  if (targetEventId === undefined) {
    throw new DomainValidationError(
      "MISSING_TARGET_EVENT",
      "Update and cancel candidates require targetEventId.",
    );
  }
  const target = currentById.get(targetEventId);
  if (target === undefined) {
    throw new DomainValidationError(
      "MISSING_TARGET_EVENT",
      `Target event ${targetEventId} does not exist.`,
    );
  }
  if (target.status !== "approved") {
    throw new DomainValidationError(
      "CHANGE_PROPOSAL_CONFLICT",
      `Target event ${targetEventId} is ${target.status}; expected approved.`,
    );
  }
  return target;
}

function uniqueEvents(
  events: readonly BuildingEvent[],
): ReadonlyMap<string, BuildingEvent> {
  const map = new Map<string, BuildingEvent>();
  for (const event of events) {
    if (map.has(event.id)) {
      throw new DomainValidationError(
        "DUPLICATE_EVENT_ID",
        `Event id ${event.id} occurs more than once.`,
      );
    }
    map.set(event.id, event);
  }
  return map;
}

function cloneFuture(event: FutureBuildingEvent): FutureBuildingEvent {
  return {
    ...event,
    sourceIds: [...event.sourceIds].sort(),
    ...(event.observationIds === undefined
      ? {}
      : { observationIds: [...event.observationIds].sort() }),
    schedule: [...event.schedule]
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function invalid(id: string, reason: string): DomainValidationError {
  return new DomainValidationError(
    "INVALID_CHANGE_PROPOSAL",
    `Change candidate ${id}: ${reason}.`,
  );
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}
