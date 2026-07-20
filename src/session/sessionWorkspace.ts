import {
  EVENT_TYPES,
  SCENARIOS,
  DomainValidationError,
  type CreateVisitorSessionCommand,
  type PublishedDataSnapshot,
  type SessionCustomEvent,
  type SessionEventOverride,
  type SessionLiquidityOverrides,
  type VisitorSessionBatchCommand,
  type VisitorSessionOperation,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import { validatePublishedDataSnapshot } from "../publishing/publishedSnapshot.js";

export function createVisitorSessionWorkspace(
  publication: PublishedDataSnapshot,
  command: CreateVisitorSessionCommand,
): VisitorSessionWorkspace {
  validatePublishedDataSnapshot(publication);
  validateCreateCommand(publication, command);
  const workspace: VisitorSessionWorkspace = {
    sessionId: command.sessionId,
    companyId: command.companyId,
    publicationVersion: command.publicationVersion,
    publicationFingerprint: publication.contentFingerprint,
    revision: 0,
    createdAt: command.createdAt,
    updatedAt: command.createdAt,
    expiresAt: command.expiresAt,
    baseHorizon: clone(command.horizon),
    horizon: clone(command.horizon),
    eventOverrides: [],
    customEvents: [],
    liquidityOverrides: {},
  };
  validateVisitorSessionWorkspace(workspace);
  return clone(workspace);
}

export function applyVisitorSessionBatch(
  current: VisitorSessionWorkspace,
  command: VisitorSessionBatchCommand,
): VisitorSessionWorkspace {
  validateVisitorSessionWorkspace(current);
  validateBatchCommand(current, command);
  const keys = new Set<string>();
  let hasReset = false;
  for (const operation of command.operations) {
    const key = operationKey(operation);
    if (key === "reset") hasReset = true;
    if (keys.has(key)) {
      throw invalidSession(`Duplicate session operation ${key}`);
    }
    keys.add(key);
  }
  if (hasReset && command.operations.length > 1) {
    throw invalidSession("reset_workspace must be the only operation in a batch");
  }

  let eventOverrides = clone(current.eventOverrides);
  let customEvents = clone(current.customEvents);
  let horizon = clone(current.horizon);
  let liquidityOverrides = clone(current.liquidityOverrides);

  for (const operation of command.operations) {
    switch (operation.type) {
      case "save_event_override":
        validateEventOverride(operation.value);
        eventOverrides = upsertById(eventOverrides, operation.value);
        break;
      case "remove_event_override":
        eventOverrides = removeById(
          eventOverrides,
          operation.overrideId,
          "event override",
        );
        break;
      case "save_custom_event":
        validateCustomEvent(operation.value);
        customEvents = upsertById(customEvents, operation.value);
        break;
      case "remove_custom_event":
        customEvents = removeById(
          customEvents,
          operation.customEventId,
          "custom event",
        );
        break;
      case "set_horizon":
        validateHorizon(operation.value.startYear, operation.value.endYear);
        horizon = clone(operation.value);
        break;
      case "set_liquidity_overrides":
        validateLiquidityOverrides(operation.value);
        liquidityOverrides = clone(operation.value);
        break;
      case "reset_workspace":
        eventOverrides = [];
        customEvents = [];
        horizon = clone(current.baseHorizon);
        liquidityOverrides = {};
        break;
    }
  }

  const next: VisitorSessionWorkspace = {
    ...clone(current),
    revision: current.revision + 1,
    updatedAt: command.occurredAt,
    horizon,
    eventOverrides: sortById(eventOverrides),
    customEvents: sortById(customEvents),
    liquidityOverrides,
  };
  validateVisitorSessionWorkspace(next);
  return clone(next);
}

export function validateVisitorSessionWorkspace(
  workspace: VisitorSessionWorkspace,
): void {
  if (!nonEmpty(workspace.sessionId) || !nonEmpty(workspace.companyId) ||
      !Number.isInteger(workspace.publicationVersion) ||
      workspace.publicationVersion <= 0 ||
      !nonEmpty(workspace.publicationFingerprint) ||
      !Number.isInteger(workspace.revision) || workspace.revision < 0 ||
      !validDate(workspace.createdAt) || !validDate(workspace.updatedAt) ||
      !validDate(workspace.expiresAt) ||
      Date.parse(workspace.expiresAt) <= Date.parse(workspace.createdAt) ||
      Date.parse(workspace.updatedAt) < Date.parse(workspace.createdAt) ||
      Date.parse(workspace.updatedAt) >= Date.parse(workspace.expiresAt)) {
    throw invalidSession("Session workspace metadata is invalid");
  }
  validateHorizon(workspace.baseHorizon.startYear, workspace.baseHorizon.endYear);
  validateHorizon(workspace.horizon.startYear, workspace.horizon.endYear);
  uniqueIds(workspace.eventOverrides, "event override");
  uniqueIds(workspace.customEvents, "custom event");
  const targets = new Set<string>();
  for (const override of workspace.eventOverrides) {
    validateEventOverride(override);
    const target = `${override.eventId}\u0000${override.scheduleEntryId}`;
    if (targets.has(target)) {
      throw invalidSession(
        `Several overrides target ${override.eventId}/${override.scheduleEntryId}`,
      );
    }
    targets.add(target);
  }
  workspace.customEvents.forEach(validateCustomEvent);
  validateLiquidityOverrides(workspace.liquidityOverrides);
}

function validateCreateCommand(
  publication: PublishedDataSnapshot,
  command: CreateVisitorSessionCommand,
): void {
  if (!nonEmpty(command.sessionId) || command.companyId !== publication.companyId ||
      command.publicationVersion !== publication.publicationVersion ||
      !validDate(command.createdAt) || !validDate(command.expiresAt) ||
      Date.parse(command.createdAt) < Date.parse(publication.publishedAt) ||
      Date.parse(command.expiresAt) <= Date.parse(command.createdAt)) {
    throw invalidSession("Create-session command is invalid");
  }
  validateHorizon(command.horizon.startYear, command.horizon.endYear);
}

function validateBatchCommand(
  current: VisitorSessionWorkspace,
  command: VisitorSessionBatchCommand,
): void {
  if (command.sessionId !== current.sessionId ||
      command.expectedRevision !== current.revision) {
    throw new DomainValidationError(
      "SESSION_REVISION_CONFLICT",
      `Session ${current.sessionId} revision changed from ` +
        `${command.expectedRevision} to ${current.revision}.`,
    );
  }
  if (!validDate(command.occurredAt) ||
      Date.parse(command.occurredAt) < Date.parse(current.updatedAt)) {
    throw invalidSession("Session batch occurredAt is invalid");
  }
  if (Date.parse(command.occurredAt) >= Date.parse(current.expiresAt)) {
    throw new DomainValidationError(
      "SESSION_EXPIRED",
      `Session ${current.sessionId} expired at ${current.expiresAt}.`,
    );
  }
  if (command.operations.length === 0) {
    throw invalidSession("Session batch requires at least one operation");
  }
}

function validateEventOverride(value: SessionEventOverride): void {
  const hasYear = Object.hasOwn(value, "year");
  const hasAmount = Object.hasOwn(value, "amount");
  const hasQuantity = Object.hasOwn(value, "quantity");
  const excluded = value.excluded === true;
  if (!nonEmpty(value.id) || !nonEmpty(value.eventId) ||
      !nonEmpty(value.scheduleEntryId) ||
      (!excluded && !hasYear && !hasAmount && !hasQuantity) ||
      (value.excluded !== undefined && value.excluded !== true) ||
      (excluded && (hasYear || hasAmount || hasQuantity)) ||
      (value.year !== undefined && !Number.isInteger(value.year)) ||
      (value.amount !== undefined && value.amount !== null &&
        !nonNegative(value.amount)) ||
      (value.quantity !== undefined && value.quantity !== null &&
        (!Number.isInteger(value.quantity) || value.quantity <= 0)) ||
      (value.explanation !== undefined && !nonEmpty(value.explanation))) {
    throw invalidSession(`Event override ${value.id || "<empty>"} is invalid`);
  }
}

function validateCustomEvent(value: SessionCustomEvent): void {
  if (!nonEmpty(value.id) || !nonEmpty(value.assetId) || !nonEmpty(value.title) ||
      !EVENT_TYPES.includes(value.type) || value.schedule.length === 0 ||
      (value.notes !== undefined && !nonEmpty(value.notes))) {
    throw invalidSession(`Custom event ${value.id || "<empty>"} is invalid`);
  }
  const ids = new Set<string>();
  for (const entry of value.schedule) {
    if (!nonEmpty(entry.id) || ids.has(entry.id) ||
        !SCENARIOS.includes(entry.scenario) || !Number.isInteger(entry.year) ||
        (entry.amount !== undefined && !nonNegative(entry.amount)) ||
        (entry.quantity !== undefined &&
          (!Number.isInteger(entry.quantity) || entry.quantity <= 0)) ||
        (entry.explanation !== undefined && !nonEmpty(entry.explanation))) {
      throw invalidSession(`Custom event ${value.id} has an invalid schedule row`);
    }
    ids.add(entry.id);
  }
}

function validateLiquidityOverrides(value: SessionLiquidityOverrides): void {
  const annual = value.annualRepairCollectionByScenario;
  if ((value.currentCash !== undefined && !nonNegative(value.currentCash)) ||
      (value.trailing12mOperatingCosts !== undefined &&
        !nonNegative(value.trailing12mOperatingCosts)) ||
      (value.bufferMonths !== undefined &&
        (!Number.isFinite(value.bufferMonths) || value.bufferMonths <= 0)) ||
      (value.operatingBufferTarget !== undefined &&
        value.operatingBufferTarget !== null &&
        !nonNegative(value.operatingBufferTarget)) ||
      (value.totalChargeableAreaM2 !== undefined &&
        (!Number.isFinite(value.totalChargeableAreaM2) ||
          value.totalChargeableAreaM2 <= 0)) ||
      (value.apartmentCount !== undefined &&
        (!Number.isInteger(value.apartmentCount) || value.apartmentCount <= 0)) ||
      (annual !== undefined && Object.entries(annual).some(([scenario, amount]) =>
        !SCENARIOS.includes(scenario as (typeof SCENARIOS)[number]) ||
        amount === undefined || !nonNegative(amount)
      ))) {
    throw invalidSession("Session liquidity overrides are invalid");
  }
}

function validateHorizon(startYear: number, endYear: number): void {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) ||
      startYear > endYear) {
    throw new DomainValidationError(
      "INVALID_HORIZON",
      `Invalid horizon ${startYear}–${endYear}.`,
    );
  }
}

function operationKey(operation: VisitorSessionOperation): string {
  switch (operation.type) {
    case "save_event_override": return `override:${operation.value.id}`;
    case "remove_event_override": return `override:${operation.overrideId}`;
    case "save_custom_event": return `custom:${operation.value.id}`;
    case "remove_custom_event": return `custom:${operation.customEventId}`;
    case "set_horizon": return "horizon";
    case "set_liquidity_overrides": return "liquidity";
    case "reset_workspace": return "reset";
  }
}

function upsertById<T extends { readonly id: string }>(
  values: readonly T[],
  value: T,
): T[] {
  return [...values.filter((item) => item.id !== value.id), clone(value)];
}

function removeById<T extends { readonly id: string }>(
  values: readonly T[],
  id: string,
  label: string,
): T[] {
  if (!nonEmpty(id) || !values.some((item) => item.id === id)) {
    throw invalidSession(`Missing ${label} ${id || "<empty>"}`);
  }
  return values.filter((item) => item.id !== id).map(clone);
}

function uniqueIds<T extends { readonly id: string }>(
  values: readonly T[],
  label: string,
): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (!nonEmpty(value.id) || ids.has(value.id)) {
      throw invalidSession(`Duplicate or empty ${label} id ${value.id || "<empty>"}`);
    }
    ids.add(value.id);
  }
}

function sortById<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].map(clone).sort((a, b) => a.id.localeCompare(b.id));
}

function validDate(value: string): boolean {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function nonEmpty(value: string): boolean {
  return value.trim() !== "";
}

function nonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function invalidSession(message: string): DomainValidationError {
  return new DomainValidationError("INVALID_SESSION_DATA", `${message}.`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
