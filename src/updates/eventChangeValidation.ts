import {
  DomainValidationError,
  EVENT_CHANGE_PROPOSAL_STATUSES,
  EVENT_CHANGE_TYPES,
  EVENT_ORIGINS,
  EVENT_STATUSES,
  EVENT_TYPES,
  SCENARIOS,
  type EventChangeProposal,
  type FutureBuildingEvent,
} from "../domain/types.js";

/**
 * Runtime validation shared by proposal creation and decision application.
 * TypeScript types are not treated as a trust boundary because persisted,
 * imported, or form-submitted JSON can bypass compile-time checks.
 */
export function validateProposedEventShape(
  event: FutureBuildingEvent,
  contextId: string,
): void {
  if (event.id.trim() === "" || event.assetId.trim() === "" ||
      event.title.trim() === "" || event.sourceIds.length === 0 ||
      event.sourceIds.some((source) => source.trim() === "") ||
      event.schedule.length === 0 || event.status !== "suggested" ||
      !EVENT_STATUSES.includes(event.status) ||
      !EVENT_TYPES.includes(event.type) ||
      !EVENT_ORIGINS.includes(event.origin)) {
    throw invalid(
      contextId,
      "proposedEvent requires identity, valid type/origin, named sourceIds, suggested status, and schedule rows",
    );
  }

  const seenEntryIds = new Set<string>();
  for (const entry of event.schedule) {
    if (entry.id.trim() === "" || seenEntryIds.has(entry.id) ||
        !SCENARIOS.includes(entry.scenario) ||
        !Number.isInteger(entry.year) || entry.costEvidenceId.trim() === "") {
      throw invalid(
        contextId,
        "proposedEvent contains an invalid or duplicate schedule row",
      );
    }
    seenEntryIds.add(entry.id);

    if (entry.amount !== undefined &&
        (!Number.isFinite(entry.amount) || entry.amount < 0)) {
      throw invalid(contextId, "proposedEvent contains an invalid amount");
    }
    if (entry.quantity !== undefined &&
        (!Number.isInteger(entry.quantity) || entry.quantity <= 0)) {
      throw invalid(contextId, "proposedEvent contains an invalid quantity");
    }
  }
}

export function validateProposalSourcesOnEvent(
  proposalSourceIds: readonly string[],
  event: FutureBuildingEvent,
  contextId: string,
): void {
  const eventSources = new Set(event.sourceIds);
  if (proposalSourceIds.some((source) => !eventSources.has(source))) {
    throw invalid(
      contextId,
      "every proposal source must also be preserved on proposedEvent.sourceIds",
    );
  }
}

/** Validates a persisted or directly constructed proposal before any decision. */
export function validateProposalForDecision(
  proposal: EventChangeProposal,
): void {
  if (proposal.id.trim() === "" ||
      !EVENT_CHANGE_TYPES.includes(proposal.changeType) ||
      !EVENT_CHANGE_PROPOSAL_STATUSES.includes(proposal.status) ||
      proposal.sourceIds.length === 0 ||
      proposal.sourceIds.some((source) => source.trim() === "") ||
      proposal.explanation.trim() === "" ||
      proposal.createdAt.trim() === "") {
    throw invalid(
      proposal.id,
      "id, valid changeType/status, named sources, explanation, and createdAt are required",
    );
  }

  if (proposal.changeType === "add") {
    if (proposal.targetEventId !== undefined ||
        proposal.expectedTargetFingerprint !== undefined) {
      throw invalid(proposal.id, "add must not contain target metadata");
    }
    const proposed = requireSuggestedEvent(proposal.proposedEvent, proposal.id);
    validateProposalSourcesOnEvent(proposal.sourceIds, proposed, proposal.id);
    return;
  }

  if (proposal.targetEventId === undefined ||
      proposal.targetEventId.trim() === "" ||
      proposal.expectedTargetFingerprint === undefined ||
      proposal.expectedTargetFingerprint.trim() === "") {
    throw invalid(
      proposal.id,
      "update/cancel requires targetEventId and expectedTargetFingerprint",
    );
  }

  if (proposal.changeType === "cancel") {
    if (proposal.proposedEvent !== undefined) {
      throw invalid(proposal.id, "cancel must not contain proposedEvent");
    }
    return;
  }

  const proposed = requireSuggestedEvent(proposal.proposedEvent, proposal.id);
  if (proposed.id !== proposal.targetEventId) {
    throw invalid(
      proposal.id,
      `update proposedEvent.id ${proposed.id} must equal targetEventId ${proposal.targetEventId}`,
    );
  }
  validateProposalSourcesOnEvent(proposal.sourceIds, proposed, proposal.id);
}

export function requireSuggestedEvent(
  event: FutureBuildingEvent | undefined,
  contextId: string,
): FutureBuildingEvent {
  if (event === undefined || event.status !== "suggested") {
    throw invalid(contextId, "add/update proposedEvent must have status suggested");
  }
  validateProposedEventShape(event, contextId);
  return event;
}

function invalid(id: string, reason: string): DomainValidationError {
  return new DomainValidationError(
    "INVALID_CHANGE_PROPOSAL",
    `Change proposal ${id || "<empty>"}: ${reason}.`,
  );
}
