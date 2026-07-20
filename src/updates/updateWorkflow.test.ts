import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  type BuildingEvent,
  type EventChangeCandidate,
  type EventChangeProposal,
  type EventReviewState,
  type FutureBuildingEvent,
} from "../domain/types.js";
import {
  annualReport2026SourceId,
  annualReportCurrentEvents,
  annualReportUpdateAssets,
  annualReportUpdateCandidates,
  annualReportUpdateCostEvidence,
  balconyCancelCandidate,
  facadePaintingUpdateCandidate,
  facadeStudyAddCandidate,
} from "../fixtures/annualReportUpdate.js";
import { correctedWorkbookLiquidityBaseline } from "../fixtures/liquidityBaseline.js";
import { buildLiquidityForecast } from "../liquidity/buildLiquidityForecast.js";
import { buildProjection } from "../projection/buildProjection.js";
import { applyEventDecision } from "./applyEventDecision.js";
import { diffEventProposals } from "./diffEventProposals.js";
import { eventFingerprint } from "./eventFingerprint.js";

const horizon = { startYear: 2026, endYear: 2040 } as const;

function diff(candidates: readonly EventChangeCandidate[] = annualReportUpdateCandidates) {
  return diffEventProposals({
    currentEvents: annualReportCurrentEvents,
    candidates,
  });
}

function initialState(proposals: readonly EventChangeProposal[] = diff().proposals): EventReviewState {
  return {
    events: annualReportCurrentEvents,
    proposals,
    auditTrail: [],
  };
}

function decide(
  state: EventReviewState,
  proposalId: string,
  decision: "accept" | "reject" = "accept",
): EventReviewState {
  return applyEventDecision(state, {
    proposalId,
    decision,
    decidedAt: "2026-07-17T13:00:00+03:00",
    decidedBy: "board-user",
  });
}

function projection(events: readonly BuildingEvent[]) {
  return buildProjection({
    assets: annualReportUpdateAssets,
    events,
    costEvidence: annualReportUpdateCostEvidence,
    horizon,
  });
}

function expectDomainError(
  action: () => unknown,
  code: DomainValidationError["code"],
): void {
  try {
    action();
    throw new Error("Expected DomainValidationError");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).code).toBe(code);
  }
}

function requireProposal(id: string): EventChangeProposal {
  const proposal = diff().proposals.find((item) => item.id === id);
  if (proposal === undefined) {
    throw new Error(`Missing proposal ${id}`);
  }
  return proposal;
}

describe("diffEventProposals", () => {
  it("creates pending add, update, and cancel proposals with named sources", () => {
    const result = diff();

    expect(result.proposals.map(({ id, changeType, status }) => ({
      id,
      changeType,
      status,
    }))).toEqual([
      {
        id: "proposal_add_facade_condition_study_2028",
        changeType: "add",
        status: "pending",
      },
      {
        id: "proposal_cancel_balcony_soffit_treatment",
        changeType: "cancel",
        status: "pending",
      },
      {
        id: "proposal_move_facade_painting_base_2030",
        changeType: "update",
        status: "pending",
      },
    ]);
    expect(result.proposals.every((proposal) =>
      proposal.sourceIds.includes(annualReport2026SourceId)
    )).toBe(true);
  });

  it("captures target fingerprints for update and cancel but not add", () => {
    const result = diff();
    const add = result.proposals.find((item) => item.changeType === "add");
    const targeted = result.proposals.filter((item) => item.changeType !== "add");

    expect(add?.expectedTargetFingerprint).toBeUndefined();
    expect(targeted.every((item) =>
      typeof item.expectedTargetFingerprint === "string"
    )).toBe(true);
  });

  it("does not emit a proposal for a semantic no-op update", () => {
    const current = annualReportCurrentEvents.find((event) =>
      event.id === "event_exterior_wall_painting"
    );
    if (current === undefined || current.status !== "approved") {
      throw new Error("Missing fixture event");
    }
    const noOp: EventChangeCandidate = {
      id: "proposal_noop",
      changeType: "update",
      targetEventId: current.id,
      sourceIds: [...current.sourceIds],
      explanation: "No actual change.",
      createdAt: "2026-07-17T12:03:00+03:00",
      proposedEvent: { ...current, status: "suggested" },
    };

    expect(diff([noOp])).toEqual({
      proposals: [],
      unchangedCandidateIds: ["proposal_noop"],
    });
  });

  it("is deterministic for reversed candidates and unordered source/schedule arrays", () => {
    const reversed = annualReportUpdateCandidates
      .map((candidate) => ({
        ...candidate,
        sourceIds: [...candidate.sourceIds].reverse(),
        ...(candidate.proposedEvent === undefined
          ? {}
          : {
              proposedEvent: {
                ...candidate.proposedEvent,
                sourceIds: [...candidate.proposedEvent.sourceIds].reverse(),
                schedule: [...candidate.proposedEvent.schedule].reverse(),
              },
            }),
      }))
      .reverse();

    expect(diff(reversed)).toEqual(diff());
  });

  it("rejects source-less, duplicate, malformed, and missing-target candidates", () => {
    expectDomainError(
      () => diff([{ ...facadeStudyAddCandidate, sourceIds: [] }]),
      "MISSING_CHANGE_SOURCE",
    );
    expectDomainError(
      () => diff([facadeStudyAddCandidate, facadeStudyAddCandidate]),
      "DUPLICATE_CHANGE_PROPOSAL_ID",
    );
    expectDomainError(
      () => diff([{
        ...facadeStudyAddCandidate,
        proposedEvent: {
          ...(facadeStudyAddCandidate.proposedEvent as FutureBuildingEvent),
          schedule: [],
        },
      }]),
      "INVALID_CHANGE_PROPOSAL",
    );
    expectDomainError(
      () => diff([{ ...balconyCancelCandidate, targetEventId: "missing" }]),
      "MISSING_TARGET_EVENT",
    );
  });

  it("requires proposal sources to be preserved on the proposed event", () => {
    expectDomainError(
      () => diff([{
        ...facadeStudyAddCandidate,
        proposedEvent: {
          ...(facadeStudyAddCandidate.proposedEvent as FutureBuildingEvent),
          sourceIds: ["different_source"],
        },
      }]),
      "INVALID_CHANGE_PROPOSAL",
    );
  });

  it("fingerprints semantically identical schedule rows independent of key insertion order", () => {
    const current = annualReportCurrentEvents.find((event) =>
      event.id === "event_exterior_wall_painting"
    );
    if (current === undefined || current.status !== "approved") {
      throw new Error("Missing fixture event");
    }

    const reorderedSchedule = current.schedule.map((entry) => {
      const fields: Array<readonly [string, unknown]> = [];
      if (entry.explanation !== undefined) {
        fields.push(["explanation", entry.explanation]);
      }
      fields.push(["costEvidenceId", entry.costEvidenceId]);
      if (entry.quantity !== undefined) {
        fields.push(["quantity", entry.quantity]);
      }
      if (entry.amount !== undefined) {
        fields.push(["amount", entry.amount]);
      }
      fields.push(
        ["year", entry.year],
        ["scenario", entry.scenario],
        ["id", entry.id],
      );
      return Object.fromEntries(fields) as unknown as typeof entry;
    });
    const reordered = { ...current, schedule: reorderedSchedule };

    expect(eventFingerprint(reordered)).toBe(eventFingerprint(current));
  });
});

describe("applyEventDecision", () => {
  it("keeps pending proposals outside the projection", () => {
    const before = projection(initialState().events);

    expect(before.scenarios.base.years.some((year) => year.year === 2028 &&
      year.events.some((event) => event.id.includes("facade_condition_study"))))
      .toBe(false);
    expect(initialState().proposals.every((proposal) => proposal.status === "pending"))
      .toBe(true);
  });

  it("accepts an add and makes only the new independent event projectable", () => {
    const result = decide(initialState(), facadeStudyAddCandidate.id);
    const added = result.events.find((event) =>
      event.id === "event_facade_condition_study_2028"
    );
    const projected = projection(result.events);

    expect(added?.status).toBe("approved");
    expect(projected.scenarios.base.years.find((year) => year.year === 2028))
      .toMatchObject({ amount: 3_500, eventCount: 1 });
    expect(result.events.find((event) =>
      event.id === "event_exterior_wall_painting"
    )?.status).toBe("approved");
  });

  it("accepts an update and replaces only the named event", () => {
    const result = decide(initialState(), facadePaintingUpdateCandidate.id);
    const updated = result.events.find((event) =>
      event.id === "event_exterior_wall_painting"
    );
    if (updated === undefined || updated.status !== "approved") {
      throw new Error("Missing updated event");
    }

    expect(updated.schedule.find((entry) => entry.scenario === "base")?.year)
      .toBe(2030);
    expect(result.events.find((event) =>
      event.id === "event_facade_timber_structure"
    )).toEqual(annualReportCurrentEvents.find((event) =>
      event.id === "event_facade_timber_structure"
    ));
  });

  it("preserves the complete before and after snapshots in audit history", () => {
    const result = decide(initialState(), facadePaintingUpdateCandidate.id);
    const audit = result.auditTrail[0];

    expect(audit).toMatchObject({
      proposalId: facadePaintingUpdateCandidate.id,
      decision: "accept",
      changeType: "update",
      decidedBy: "board-user",
    });
    expect(audit?.beforeEvent).toEqual(annualReportCurrentEvents.find((event) =>
      event.id === "event_exterior_wall_painting"
    ));
    expect(audit?.afterEvent).toEqual(result.events.find((event) =>
      event.id === "event_exterior_wall_painting"
    ));
  });

  it("accepts cancellation by changing only the named event to cancelled", () => {
    const result = decide(initialState(), balconyCancelCandidate.id);
    const target = result.events.find((event) =>
      event.id === "event_balcony_soffit_treatment"
    );
    const projected = projection(result.events);

    expect(target?.status).toBe("cancelled");
    expect(projected.cancelled.map((event) => event.id))
      .toContain("event_balcony_soffit_treatment");
    expect(projected.scenarios.base.years.flatMap((year) => year.events)
      .some((event) => event.eventId === "event_balcony_soffit_treatment"))
      .toBe(false);
  });

  it("rejects a proposal without changing events", () => {
    const beforeState = initialState();
    const result = decide(beforeState, facadeStudyAddCandidate.id, "reject");

    expect(result.events).toEqual(
      [...beforeState.events].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(result.proposals.find((proposal) =>
      proposal.id === facadeStudyAddCandidate.id
    )?.status).toBe("rejected");
    expect(result.auditTrail[0]).toMatchObject({ decision: "reject" });
    expect(result.auditTrail[0]).not.toHaveProperty("afterEvent");
  });

  it("does not allow the same proposal to be decided twice", () => {
    const accepted = decide(initialState(), facadeStudyAddCandidate.id);
    expectDomainError(
      () => decide(accepted, facadeStudyAddCandidate.id),
      "CHANGE_PROPOSAL_ALREADY_DECIDED",
    );
  });

  it("detects a stale target fingerprint before applying an update", () => {
    const proposal = requireProposal(facadePaintingUpdateCandidate.id);
    const changedEvents = annualReportCurrentEvents.map((event) =>
      event.id === proposal.targetEventId && event.status === "approved"
        ? { ...event, notes: "Edited after proposal creation." }
        : event
    );

    expectDomainError(
      () => decide({
        events: changedEvents,
        proposals: [proposal],
        auditTrail: [],
      }, proposal.id),
      "CHANGE_PROPOSAL_CONFLICT",
    );
  });

  it("detects a conflicting add when the event id appears after proposal creation", () => {
    const proposal = requireProposal(facadeStudyAddCandidate.id);
    const proposed = proposal.proposedEvent;
    if (proposed === undefined) {
      throw new Error("Missing proposed event");
    }
    const existing: FutureBuildingEvent = { ...proposed, status: "approved" };

    expectDomainError(
      () => decide({
        events: [...annualReportCurrentEvents, existing],
        proposals: [proposal],
        auditTrail: [],
      }, proposal.id),
      "CHANGE_PROPOSAL_CONFLICT",
    );
  });

  it("rejects a second stale proposal created from the same old target version", () => {
    const first = requireProposal(facadePaintingUpdateCandidate.id);
    const second: EventChangeProposal = {
      ...first,
      id: "proposal_second_facade_edit",
      proposedEvent: {
        ...(first.proposedEvent as FutureBuildingEvent),
        title: "Toinen julkisivuehdotus",
      },
    };
    const afterFirst = decide({
      events: annualReportCurrentEvents,
      proposals: [first, second],
      auditTrail: [],
    }, first.id);

    expectDomainError(
      () => decide(afterFirst, second.id),
      "CHANGE_PROPOSAL_CONFLICT",
    );
  });

  it("validates directly constructed proposals again at the decision boundary", () => {
    const proposal = requireProposal(facadeStudyAddCandidate.id);
    const proposed = proposal.proposedEvent;
    if (proposed === undefined) {
      throw new Error("Missing proposed event");
    }
    const firstRow = proposed.schedule[0];
    if (firstRow === undefined) {
      throw new Error("Missing schedule row");
    }
    const malformed: EventChangeProposal = {
      ...proposal,
      proposedEvent: {
        ...proposed,
        schedule: [
          firstRow,
          { ...firstRow, amount: -1 },
        ],
      },
    };

    expectDomainError(
      () => decide({
        events: annualReportCurrentEvents,
        proposals: [malformed],
        auditTrail: [],
      }, malformed.id),
      "INVALID_CHANGE_PROPOSAL",
    );
  });

  it("keeps audit snapshots deeply independent from the active event base", () => {
    const result = decide(initialState(), facadePaintingUpdateCandidate.id);
    const audit = result.auditTrail[0];
    const active = result.events.find((event) =>
      event.id === "event_exterior_wall_painting"
    );
    if (audit?.beforeEvent === undefined || audit.afterEvent === undefined ||
        active === undefined || active.status !== "approved" ||
        audit.afterEvent.status !== "approved") {
      throw new Error("Missing audit or active event");
    }

    const activeTitle = active.title;
    const activeYear = active.schedule[0]?.year;
    const auditTitle = audit.afterEvent.title;
    const auditYear = audit.afterEvent.schedule[0]?.year;
    const fixtureTitle = annualReportCurrentEvents.find((event) =>
      event.id === "event_exterior_wall_painting"
    )?.title;

    (audit.afterEvent as unknown as { title: string }).title = "Audit mutation";
    (audit.afterEvent.schedule[0] as unknown as { year: number }).year = 1900;
    (audit.beforeEvent as unknown as { title: string }).title = "Before mutation";

    expect(active.title).toBe(activeTitle);
    expect(active.schedule[0]?.year).toBe(activeYear);
    expect(annualReportCurrentEvents.find((event) =>
      event.id === "event_exterior_wall_painting"
    )?.title).toBe(fixtureTitle);

    (active as unknown as { title: string }).title = "Active mutation";
    (active.schedule[0] as unknown as { year: number }).year = 1901;

    expect(audit.afterEvent.title).not.toBe("Active mutation");
    expect(audit.afterEvent.schedule[0]?.year).not.toBe(1901);
    expect(auditTitle).not.toBe("Active mutation");
    expect(auditYear).not.toBe(1901);
  });

  it("allows only the first of two add proposals using the same new event id", () => {
    const first = requireProposal(facadeStudyAddCandidate.id);
    const second: EventChangeProposal = {
      ...first,
      id: "proposal_second_add_same_event",
    };
    const afterFirst = decide({
      events: annualReportCurrentEvents,
      proposals: [first, second],
      auditTrail: [],
    }, first.id);

    expectDomainError(
      () => decide(afterFirst, second.id),
      "CHANGE_PROPOSAL_CONFLICT",
    );
  });

  it("allows only the first of update and cancel proposals from one target version", () => {
    const update = requireProposal(facadePaintingUpdateCandidate.id);
    if (update.targetEventId === undefined ||
        update.expectedTargetFingerprint === undefined) {
      throw new Error("Missing target metadata");
    }
    const cancel: EventChangeProposal = {
      id: "proposal_cancel_facade_from_same_version",
      changeType: "cancel",
      sourceIds: [...update.sourceIds],
      explanation: "Cancel from the same captured event version.",
      createdAt: update.createdAt,
      status: "pending",
      targetEventId: update.targetEventId,
      expectedTargetFingerprint: update.expectedTargetFingerprint,
    };
    const afterUpdate = decide({
      events: annualReportCurrentEvents,
      proposals: [update, cancel],
      auditTrail: [],
    }, update.id);

    expectDomainError(
      () => decide(afterUpdate, cancel.id),
      "CHANGE_PROPOSAL_CONFLICT",
    );
  });

  it("reaches the same final event base for independent decisions in any order", () => {
    const ids = [
      facadeStudyAddCandidate.id,
      facadePaintingUpdateCandidate.id,
      balconyCancelCandidate.id,
    ] as const;
    const applyOrder = (order: readonly string[]) => order.reduce(
      (state, id) => decide(state, id),
      initialState(),
    );

    const forward = applyOrder(ids);
    const reverse = applyOrder([...ids].reverse());

    expect(reverse.events).toEqual(forward.events);
    expect(reverse.proposals).toEqual(forward.proposals);
    expect(reverse.auditTrail).toEqual(forward.auditTrail);
  });

  it("rejects duplicate proposal ids in a persisted review state", () => {
    const proposal = requireProposal(facadeStudyAddCandidate.id);
    expectDomainError(
      () => decide({
        events: annualReportCurrentEvents,
        proposals: [proposal, proposal],
        auditTrail: [],
      }, proposal.id),
      "DUPLICATE_CHANGE_PROPOSAL_ID",
    );
  });

  it("does not mutate current events, proposals, candidates, or audit arrays", () => {
    const candidatesBefore = JSON.stringify(annualReportUpdateCandidates);
    const state = initialState();
    const stateBefore = JSON.stringify(state);

    decide(state, facadePaintingUpdateCandidate.id);

    expect(JSON.stringify(annualReportUpdateCandidates)).toBe(candidatesBefore);
    expect(JSON.stringify(state)).toBe(stateBefore);
  });

  it("returns deterministic state regardless of initial event and proposal order", () => {
    const normal = decide(initialState(), facadePaintingUpdateCandidate.id);
    const reversed = decide({
      events: [...annualReportCurrentEvents].reverse(),
      proposals: [...diff().proposals].reverse(),
      auditTrail: [],
    }, facadePaintingUpdateCandidate.id);

    expect(reversed).toEqual(normal);
  });
});

describe("workflow integration", () => {
  it("updates projection only after acceptance and preserves unrelated events", () => {
    const before = projection(initialState().events);
    const afterState = decide(initialState(), facadeStudyAddCandidate.id);
    const after = projection(afterState.events);

    expect(after.scenarios.base.horizonAmount - before.scenarios.base.horizonAmount)
      .toBe(3_500);
    expect(afterState.events.find((event) =>
      event.id === "event_exterior_wall_painting"
    )).toEqual(initialState().events.find((event) =>
      event.id === "event_exterior_wall_painting"
    ));
  });

  it("flows an accepted numeric event through to the liquidity forecast", () => {
    const beforeProjection = projection(initialState().events);
    const acceptedState = decide(initialState(), facadeStudyAddCandidate.id);
    const afterProjection = projection(acceptedState.events);
    const common = {
      horizon,
      currentCash: correctedWorkbookLiquidityBaseline.currentCash,
      trailing12mOperatingCosts:
        correctedWorkbookLiquidityBaseline.trailing12mOperatingCosts,
      currentAnnualRepairCollection: 0,
    } as const;
    const before = buildLiquidityForecast({
      projection: beforeProjection,
      ...common,
    });
    const after = buildLiquidityForecast({
      projection: afterProjection,
      ...common,
    });

    expect(after.scenarios.base.cashPath.knownRepairCostsTotal -
      before.scenarios.base.cashPath.knownRepairCostsTotal).toBe(3_500);
    expect(before.scenarios.base.cashPath.finalCash -
      after.scenarios.base.cashPath.finalCash).toBe(3_500);
  });

  it("keeps document-update proposals as review objects and never infers event dependencies", () => {
    const result = diff();

    expect(result.proposals.every((proposal) => proposal.status === "pending"))
      .toBe(true);
    expect(JSON.stringify(result)).not.toContain("supersedes");
    expect(JSON.stringify(result)).not.toContain("cycle");
    expect(eventFingerprint(
      annualReportCurrentEvents.find((event) =>
        event.id === "event_exterior_wall_painting"
      ) as BuildingEvent,
    )).toMatch(/^[0-9a-f]{8}$/);
  });
});
