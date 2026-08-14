import {
  DomainValidationError,
  type AdminAuditEntry,
  type AdminDataBatchCommand,
  type AdminDataOperation,
  type AdminDataSnapshot,
  type AdminEntitySnapshot,
  type AdminEntityType,
  type BuildingEvent,
  type FinancialAccount,
  type FinancialEntry,
} from "../domain/types.js";
import { validateAdminDataSnapshot, validateBuildingEventRuntime } from "./adminDataValidation.js";

export interface CreateAdminSnapshotInput {
  readonly housingCompany: AdminDataSnapshot["housingCompany"];
  readonly financialYears?: AdminDataSnapshot["financialYears"];
  readonly liquidityBaselines?: AdminDataSnapshot["liquidityBaselines"];
  readonly assets?: AdminDataSnapshot["assets"];
  readonly observations?: AdminDataSnapshot["observations"];
  readonly costEvidence?: AdminDataSnapshot["costEvidence"];
  readonly priceLevelConfirmations?: AdminDataSnapshot["priceLevelConfirmations"];
  readonly events?: AdminDataSnapshot["events"];
  readonly financialAccounts?: AdminDataSnapshot["financialAccounts"];
  readonly financialEntries?: AdminDataSnapshot["financialEntries"];
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export function createAdminDataSnapshot(
  input: CreateAdminSnapshotInput,
): AdminDataSnapshot {
  const state: AdminDataSnapshot = {
    companyId: input.housingCompany.id,
    revision: 0,
    housingCompany: clone(input.housingCompany),
    financialYears: clone(input.financialYears ?? []),
    liquidityBaselines: clone(input.liquidityBaselines ?? []),
    assets: clone(input.assets ?? []),
    observations: clone(input.observations ?? []),
    costEvidence: clone(input.costEvidence ?? []),
    priceLevelConfirmations: clone(input.priceLevelConfirmations ?? []),
    events: clone(input.events ?? []),
    financialAccounts: clone(input.financialAccounts ?? []),
    financialEntries: clone(input.financialEntries ?? []),
    auditTrail: [],
    updatedAt: input.updatedAt,
    updatedBy: input.updatedBy,
  };
  validateAdminDataSnapshot(state);
  return clone(state);
}

/**
 * Applies one atomic admin batch to an immutable snapshot.
 * All operations are staged first and the complete resulting state is
 * validated before any audit entries or repository commit can be returned.
 */
export function applyAdminBatch(
  state: AdminDataSnapshot,
  command: AdminDataBatchCommand,
): AdminDataSnapshot {
  validateCommand(state, command);

  const mutable = clone(state) as MutableAdminState;
  const revision = state.revision + 1;
  const stagedAudits: AdminAuditEntry[] = [];
  const operationKeys = new Set<string>();

  command.operations.forEach((operation, index) => {
    validateOperationMetadata(operation);
    const descriptor = describeOperation(operation);
    const compoundKey = `${descriptor.entityType}:${descriptor.entityKey}`;
    if (operationKeys.has(compoundKey)) {
      throw new DomainValidationError(
        "DUPLICATE_ADMIN_OPERATION",
        `Admin batch contains ${compoundKey} more than once.`,
      );
    }
    operationKeys.add(compoundKey);

    const before = findCurrent(mutable, descriptor.entityType, descriptor.entityKey);
    saveOperation(mutable, operation);
    const after = findCurrent(mutable, descriptor.entityType, descriptor.entityKey);
    if (after === undefined) {
      throw new DomainValidationError(
        "INVALID_ADMIN_OPERATION",
        `Admin operation ${operation.type} did not create an after snapshot.`,
      );
    }
    stagedAudits.push({
      id: `${revision}:${String(index + 1).padStart(3, "0")}:${compoundKey}`,
      revision,
      entityType: descriptor.entityType,
      entityKey: descriptor.entityKey,
      operation: before === undefined ? "create" : "update",
      actorId: command.actorId,
      occurredAt: command.occurredAt,
      sourceIds: [...operation.sourceIds].sort(),
      explanation: operation.explanation,
      ...(before === undefined ? {} : { before: clone(before) }),
      after: clone(after),
    });
  });

  const next: AdminDataSnapshot = {
    ...normalize(mutable),
    revision,
    auditTrail: [...state.auditTrail.map(clone), ...stagedAudits.map(clone)],
    updatedAt: command.occurredAt,
    updatedBy: command.actorId,
  };
  validateAdminDataSnapshot(next);
  return clone(next);
}

interface MutableAdminState {
  companyId: string;
  revision: number;
  housingCompany: AdminDataSnapshot["housingCompany"];
  financialYears: AdminDataSnapshot["financialYears"] extends readonly (infer T)[] ? T[] : never;
  liquidityBaselines: AdminDataSnapshot["liquidityBaselines"] extends readonly (infer T)[] ? T[] : never;
  assets: AdminDataSnapshot["assets"] extends readonly (infer T)[] ? T[] : never;
  observations: AdminDataSnapshot["observations"] extends readonly (infer T)[] ? T[] : never;
  costEvidence: AdminDataSnapshot["costEvidence"] extends readonly (infer T)[] ? T[] : never;
  priceLevelConfirmations: AdminDataSnapshot["priceLevelConfirmations"] extends readonly (infer T)[] ? T[] : never;
  events: BuildingEvent[];
  financialAccounts: FinancialAccount[];
  financialEntries: FinancialEntry[];
  auditTrail: AdminAuditEntry[];
  updatedAt: string;
  updatedBy: string;
}

function validateCommand(
  state: AdminDataSnapshot,
  command: AdminDataBatchCommand,
): void {
  if (command.companyId !== state.companyId ||
      command.expectedRevision !== state.revision ||
      command.actorId.trim() === "" || command.occurredAt.trim() === "" ||
      !Number.isFinite(Date.parse(command.occurredAt)) ||
      command.operations.length === 0) {
    const code = command.expectedRevision !== state.revision
      ? "ADMIN_REVISION_CONFLICT"
      : "INVALID_ADMIN_OPERATION";
    throw new DomainValidationError(
      code,
      `Invalid admin batch for ${command.companyId}; expected revision ` +
        `${state.revision}, received ${command.expectedRevision}.`,
    );
  }
}

function validateOperationMetadata(operation: AdminDataOperation): void {
  if (operation.sourceIds.length === 0 ||
      operation.sourceIds.some((item) => item.trim() === "") ||
      operation.explanation.trim() === "") {
    throw new DomainValidationError(
      "INVALID_ADMIN_OPERATION",
      `Admin operation ${operation.type} requires sourceIds and explanation.`,
    );
  }
  if (operation.type === "save_building_event") {
    validateBuildingEventRuntime(operation.value);
  }
}

function describeOperation(operation: AdminDataOperation): {
  readonly entityType: AdminEntityType;
  readonly entityKey: string;
} {
  switch (operation.type) {
    case "save_housing_company":
      return { entityType: "housing_company", entityKey: operation.value.id };
    case "save_financial_year":
      return { entityType: "financial_year", entityKey: String(operation.value.year) };
    case "save_liquidity_baseline":
      return { entityType: "liquidity_baseline", entityKey: operation.value.id };
    case "save_asset":
      return { entityType: "asset", entityKey: operation.value.id };
    case "save_observation":
      return { entityType: "observation", entityKey: operation.value.id };
    case "save_cost_evidence":
      return { entityType: "cost_evidence", entityKey: operation.value.id };
    case "save_price_level_confirmation":
      return {
        entityType: "price_level_confirmation",
        entityKey: operation.value.costEvidenceId,
      };
    case "save_building_event":
      return { entityType: "building_event", entityKey: operation.value.id };
    case "save_financial_account":
      return { entityType: "financial_account", entityKey: operation.value.accountCode };
    case "save_financial_entry":
      return {
        entityType: "financial_entry",
        entityKey: `${operation.value.accountCode}:${operation.value.year}`,
      };
  }
}

function saveOperation(state: MutableAdminState, operation: AdminDataOperation): void {
  switch (operation.type) {
    case "save_housing_company":
      if (operation.value.id !== state.companyId) {
        throw new DomainValidationError(
          "INVALID_ADMIN_OPERATION",
          `Housing-company id ${operation.value.id} cannot replace ${state.companyId}.`,
        );
      }
      state.housingCompany = clone(operation.value);
      return;
    case "save_financial_year":
      state.financialYears = upsert(
        state.financialYears,
        (item) => item.year === operation.value.year,
        operation.value,
      );
      return;
    case "save_liquidity_baseline":
      state.liquidityBaselines = upsertById(state.liquidityBaselines, operation.value);
      return;
    case "save_asset":
      state.assets = upsertById(state.assets, operation.value);
      return;
    case "save_observation":
      state.observations = upsertById(state.observations, operation.value);
      return;
    case "save_cost_evidence":
      state.costEvidence = upsertById(state.costEvidence, operation.value);
      return;
    case "save_price_level_confirmation":
      state.priceLevelConfirmations = upsert(
        state.priceLevelConfirmations,
        (item) => item.costEvidenceId === operation.value.costEvidenceId,
        operation.value,
      );
      return;
    case "save_building_event":
      state.events = upsertById(state.events, operation.value);
      return;
    case "save_financial_account":
      state.financialAccounts = upsert(
        state.financialAccounts,
        (item) => item.accountCode === operation.value.accountCode,
        operation.value,
      );
      return;
    case "save_financial_entry":
      state.financialEntries = upsert(
        state.financialEntries,
        (item) =>
          item.accountCode === operation.value.accountCode &&
          item.year === operation.value.year,
        operation.value,
      );
      return;
  }
}

function findCurrent(
  state: MutableAdminState,
  entityType: AdminEntityType,
  key: string,
): AdminEntitySnapshot | undefined {
  switch (entityType) {
    case "housing_company":
      return state.housingCompany.id === key ? state.housingCompany : undefined;
    case "financial_year":
      return state.financialYears.find((item) => String(item.year) === key);
    case "liquidity_baseline":
      return state.liquidityBaselines.find((item) => item.id === key);
    case "asset":
      return state.assets.find((item) => item.id === key);
    case "observation":
      return state.observations.find((item) => item.id === key);
    case "cost_evidence":
      return state.costEvidence.find((item) => item.id === key);
    case "price_level_confirmation":
      return state.priceLevelConfirmations.find((item) => item.costEvidenceId === key);
    case "building_event":
      return state.events.find((item) => item.id === key);
    case "financial_account":
      return state.financialAccounts.find((item) => item.accountCode === key);
    case "financial_entry":
      return state.financialEntries.find(
        (item) => `${item.accountCode}:${item.year}` === key,
      );
  }
}

function normalize(state: MutableAdminState): Omit<AdminDataSnapshot, "revision" | "auditTrail" | "updatedAt" | "updatedBy"> {
  return {
    companyId: state.companyId,
    housingCompany: clone(state.housingCompany),
    financialYears: [...state.financialYears].sort((a, b) => a.year - b.year).map(clone),
    liquidityBaselines: [...state.liquidityBaselines].sort(byId).map(clone),
    assets: [...state.assets].sort(byId).map(clone),
    observations: [...state.observations].sort(byId).map(clone),
    costEvidence: [...state.costEvidence].sort(byId).map(clone),
    priceLevelConfirmations: [...state.priceLevelConfirmations]
      .sort((a, b) => a.costEvidenceId.localeCompare(b.costEvidenceId))
      .map(clone),
    events: [...state.events].sort(byId).map(clone),
    financialAccounts: [...state.financialAccounts]
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
      .map(clone),
    financialEntries: [...state.financialEntries]
      .sort((a, b) =>
        a.accountCode === b.accountCode
          ? a.year - b.year
          : a.accountCode.localeCompare(b.accountCode)
      )
      .map(clone),
  };
}

function upsertById<T extends { readonly id: string }>(
  values: readonly T[],
  value: T,
): T[] {
  return upsert(values, (item) => item.id === value.id, value);
}

function upsert<T>(
  values: readonly T[],
  matches: (item: T) => boolean,
  value: T,
): T[] {
  const index = values.findIndex(matches);
  const next = values.map(clone);
  if (index < 0) {
    next.push(clone(value));
  } else {
    next[index] = clone(value);
  }
  return next;
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
