import {
  DomainValidationError,
  type BuildingEvent,
  type CancelledBuildingEvent,
  type EventChangeAuditEntry,
  type EventChangeProposal,
  type EventProposalDecision,
  type EventReviewState,
  type FutureBuildingEvent,
} from "../domain/types.js";
import { cloneAuditSnapshot } from "./cloneAuditSnapshot.js";
import {
  approvedEventFromProposal,
  eventFingerprint,
} from "./eventFingerprint.js";
import {
  requireSuggestedEvent,
  validateProposalForDecision,
} from "./eventChangeValidation.js";

/** Applies one explicit human decision and appends an immutable audit record. */
export function applyEventDecision(
  state: EventReviewState,
  decision: EventProposalDecision,
): EventReviewState {
  validateDecision(decision);
  validateReviewState(state);
  const proposal = state.proposals.find((item) => item.id === decision.proposalId);
  if (proposal === undefined) {
    throw new DomainValidationError(
      "INVALID_CHANGE_PROPOSAL",
      `Proposal ${decision.proposalId} does not exist.`,
    );
  }
  validateProposalForDecision(proposal);
  if (proposal.status !== "pending") {
    throw new DomainValidationError(
      "CHANGE_PROPOSAL_ALREADY_DECIDED",
      `Proposal ${proposal.id} is already ${proposal.status}.`,
    );
  }

  if (decision.decision === "reject") {
    return finalizeState(state, proposal, decision, undefined, undefined);
  }

  const events = [...state.events];
  let beforeEvent: BuildingEvent | undefined;
  let afterEvent: BuildingEvent | undefined;

  if (proposal.changeType === "add") {
    const proposed = requireSuggestedEvent(proposal.proposedEvent, proposal.id);
    if (events.some((event) => event.id === proposed.id)) {
      throw new DomainValidationError(
        "CHANGE_PROPOSAL_CONFLICT",
        `Event ${proposed.id} now exists; add proposal ${proposal.id} is stale.`,
      );
    }
    afterEvent = approvedEventFromProposal(proposed);
    events.push(afterEvent);
  } else {
    const targetIndex = findTargetIndex(events, proposal);
    const target = events[targetIndex];
    if (target === undefined) {
      throw new DomainValidationError(
        "MISSING_TARGET_EVENT",
        `Target index for proposal ${proposal.id} is invalid.`,
      );
    }
    beforeEvent = target;
    validateTargetFingerprint(target, proposal);

    if (proposal.changeType === "update") {
      const proposed = requireSuggestedEvent(proposal.proposedEvent, proposal.id);
      if (proposed.id !== target.id) {
        throw new DomainValidationError(
          "INVALID_CHANGE_PROPOSAL",
          `Update proposal ${proposal.id} changes event id ` +
            `${target.id} to ${proposed.id}.`,
        );
      }
      afterEvent = approvedEventFromProposal(proposed);
    } else {
      if (target.status !== "approved") {
        throw new DomainValidationError(
          "CHANGE_PROPOSAL_CONFLICT",
          `Cancel target ${target.id} is ${target.status}.`,
        );
      }
      afterEvent = toCancelled(target);
    }
    events[targetIndex] = afterEvent;
  }

  return finalizeState(state, proposal, decision, beforeEvent, afterEvent, events);
}

function finalizeState(
  state: EventReviewState,
  proposal: EventChangeProposal,
  decision: EventProposalDecision,
  beforeEvent: BuildingEvent | undefined,
  afterEvent: BuildingEvent | undefined,
  changedEvents?: readonly BuildingEvent[],
): EventReviewState {
  const decidedProposal: EventChangeProposal = {
    ...proposal,
    status: decision.decision === "accept" ? "accepted" : "rejected",
    decidedAt: decision.decidedAt,
    decidedBy: decision.decidedBy,
  };
  const proposals = state.proposals
    .map((item) => item.id === proposal.id ? decidedProposal : item)
    .sort(byId);
  const auditEntry = toAuditEntry(
    proposal,
    decision,
    beforeEvent,
    afterEvent,
  );
  return {
    events: [...(changedEvents ?? state.events)].sort(byId),
    proposals,
    auditTrail: [...state.auditTrail, auditEntry].sort(byId),
  };
}

function toAuditEntry(
  proposal: EventChangeProposal,
  decision: EventProposalDecision,
  beforeEvent: BuildingEvent | undefined,
  afterEvent: BuildingEvent | undefined,
): EventChangeAuditEntry {
  return {
    id: `${proposal.id}:${decision.decision}`,
    proposalId: proposal.id,
    decision: decision.decision,
    changeType: proposal.changeType,
    decidedAt: decision.decidedAt,
    decidedBy: decision.decidedBy,
    sourceIds: [...proposal.sourceIds].sort(),
    explanation: proposal.explanation,
    ...(proposal.targetEventId === undefined
      ? {}
      : { targetEventId: proposal.targetEventId }),
    ...(beforeEvent === undefined
      ? {}
      : { beforeEvent: cloneAuditSnapshot(beforeEvent) }),
    ...(afterEvent === undefined
      ? {}
      : { afterEvent: cloneAuditSnapshot(afterEvent) }),
  };
}

function findTargetIndex(
  events: readonly BuildingEvent[],
  proposal: EventChangeProposal,
): number {
  if (proposal.targetEventId === undefined) {
    throw new DomainValidationError(
      "MISSING_TARGET_EVENT",
      `Proposal ${proposal.id} has no targetEventId.`,
    );
  }
  const index = events.findIndex((event) => event.id === proposal.targetEventId);
  if (index < 0) {
    throw new DomainValidationError(
      "MISSING_TARGET_EVENT",
      `Target event ${proposal.targetEventId} no longer exists.`,
    );
  }
  return index;
}

function validateTargetFingerprint(
  target: BuildingEvent,
  proposal: EventChangeProposal,
): void {
  if (proposal.expectedTargetFingerprint === undefined ||
      eventFingerprint(target) !== proposal.expectedTargetFingerprint) {
    throw new DomainValidationError(
      "CHANGE_PROPOSAL_CONFLICT",
      `Target event ${target.id} changed after proposal ${proposal.id} was created.`,
    );
  }
  if (target.status !== "approved") {
    throw new DomainValidationError(
      "CHANGE_PROPOSAL_CONFLICT",
      `Target event ${target.id} is ${target.status}; expected approved.`,
    );
  }
}

function toCancelled(event: FutureBuildingEvent): CancelledBuildingEvent {
  return {
    id: event.id,
    assetId: event.assetId,
    title: event.title,
    type: event.type,
    status: "cancelled",
    origin: event.origin,
    sourceIds: [...event.sourceIds],
    ...(event.observationIds === undefined
      ? {}
      : { observationIds: [...event.observationIds] }),
    ...(event.notes === undefined ? {} : { notes: event.notes }),
    schedule: event.schedule.map((entry) => ({ ...entry })),
  };
}

function validateReviewState(state: EventReviewState): void {
  const proposalIds = new Set<string>();
  for (const proposal of state.proposals) {
    if (proposalIds.has(proposal.id)) {
      throw new DomainValidationError(
        "DUPLICATE_CHANGE_PROPOSAL_ID",
        `Proposal id ${proposal.id} occurs more than once in review state.`,
      );
    }
    proposalIds.add(proposal.id);
  }
  const eventIds = new Set<string>();
  for (const event of state.events) {
    if (eventIds.has(event.id)) {
      throw new DomainValidationError(
        "DUPLICATE_EVENT_ID",
        `Event id ${event.id} occurs more than once in review state.`,
      );
    }
    eventIds.add(event.id);
  }
}

function validateDecision(decision: EventProposalDecision): void {
  if ((decision.decision !== "accept" && decision.decision !== "reject") ||
      decision.proposalId.trim() === "" ||
      decision.decidedAt.trim() === "" ||
      decision.decidedBy.trim() === "") {
    throw new DomainValidationError(
      "INVALID_CHANGE_PROPOSAL",
      "Decision requires proposalId, decidedAt, and decidedBy.",
    );
  }
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}
