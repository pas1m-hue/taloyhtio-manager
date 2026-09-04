/**
 * Taloyhtiö Manager V2.8a domain types.
 *
 * Every building-component event is an explicit, independent record. The
 * engine does not infer lifecycle cycles, reset dates, supersession, or
 * dependencies between events.
 */

export const PROJECTION_PRICE_LEVEL_YEAR = 2026 as const;

export const SCENARIOS = ["optimistic", "base", "stress"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export const ASSET_CATEGORIES = [
  "hvac",
  "envelope",
  "structures",
  "yard",
  "safety",
  "other",
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const EVENT_TYPES = [
  "inspection",
  "maintenance",
  "repair",
  "replacement",
  "renewal",
  "cleaning",
  "study",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = [
  "suggested",
  "approved",
  "actual",
  "cancelled",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_ORIGINS = [
  "initial_excel",
  "manual",
  "document_update",
] as const;
export type EventOrigin = (typeof EVENT_ORIGINS)[number];

export const COST_EVIDENCE_STATUSES = [
  "actual",
  "quote",
  "estimate",
  "estimate_from_actual",
  "data_gap",
] as const;
export type CostEvidenceStatus = (typeof COST_EVIDENCE_STATUSES)[number];

export interface Horizon {
  readonly startYear: number;
  readonly endYear: number;
}

export interface OperatingBufferSettings {
  readonly bufferMonths?: number;
  readonly userOverride?: number;
}

export interface HousingCompany {
  readonly id: string;
  readonly name: string;
  readonly apartmentCount: number;
  readonly chargeableAreaM2?: number;
  readonly operatingBuffer?: OperatingBufferSettings;
  /**
   * Last year the maintenance plan actually covers. User-entered; the app
   * never infers it from the last scheduled event, because a plan that ends
   * in 2030 and an event schedule reaching 2039 are different facts. When it
   * is absent the coverage is simply unknown - it is never defaulted to the
   * horizon end, which would silently claim every year is planned.
   */
  readonly maintenancePlanCoverageThroughYear?: number;
}

export interface FinancialYear {
  readonly year: number;
  readonly budgetIncome?: number;
  readonly actualIncome?: number;
  readonly budgetCosts?: number;
  readonly actualCosts?: number;
  readonly sourceIds: readonly string[];
  readonly notes?: string;
}

export const FINANCIAL_ACCOUNT_KINDS = ["income", "expense"] as const;
export type FinancialAccountKind = (typeof FINANCIAL_ACCOUNT_KINDS)[number];

export const FINANCIAL_ACCOUNT_NATURES = ["maintenance", "repair"] as const;
export type FinancialAccountNature = (typeof FINANCIAL_ACCOUNT_NATURES)[number];

export const FINANCIAL_ACCOUNT_CONTROLLABILITIES = [
  "fixed",
  "variable",
  "mixed",
] as const;
export type FinancialAccountControllability =
  (typeof FINANCIAL_ACCOUNT_CONTROLLABILITIES)[number];

/** One account in the chart of accounts. Descriptive metadata, not a yearly figure. */
export interface FinancialAccount {
  readonly accountCode: string;
  readonly name: string;
  readonly kind: FinancialAccountKind;
  readonly group: string;
  readonly nature?: FinancialAccountNature;
  readonly controllability?: FinancialAccountControllability;
  readonly active: boolean;
}

/** One account's budget and/or actual figure for one year. */
export interface FinancialEntry {
  readonly accountCode: string;
  readonly year: number;
  readonly budgetAmount?: number;
  readonly actualAmount?: number;
  readonly sourceIds: readonly string[];
  readonly notes?: string;
}

/**
 * A group-level budget figure (handoff feature/group-budget §1): budgets are
 * approved by the yhtiökokous at the account group level (e.g. "Sähkö"), not
 * per account, but actuals are recorded per account. `id` is derived
 * deterministically from kind/group/year (see buildGroupBudgetId in
 * adminOperationPayloads.js) so re-importing the same group+year updates the
 * existing row instead of duplicating it. `group` must match a
 * FinancialAccount.group string for the actual side of the comparison to
 * resolve — the parser warns, but does not block, on a non-matching name.
 * `active: false` retires a row (e.g. a typo'd group name whose id can never
 * be corrected by re-import) without deleting it, mirroring Asset.active —
 * this system has no delete operation, only create/update.
 */
export interface GroupBudget {
  readonly id: string;
  readonly group: string;
  readonly kind: FinancialAccountKind;
  readonly year: number;
  readonly budgetAmount: number;
  readonly active: boolean;
  readonly sourceIds: readonly string[];
  readonly notes?: string;
}

/**
 * Balance-sheet section (spec §11, handoff vaihe-4A §4). Five enum values
 * rather than the three top-level groups so 4B's liquidity ratios (which
 * need "vaihtuvat vastaavat" specifically, not all assets) can be computed
 * without re-deriving that split later. Grouped into VARAT / OMA PÄÄOMA /
 * VELAT in the view layer.
 */
export const BALANCE_SECTIONS = [
  "fixed_assets",
  "current_assets",
  "restricted_equity",
  "unrestricted_equity",
  "liabilities",
] as const;
export type BalanceSection = (typeof BALANCE_SECTIONS)[number];

/** One line item on a balance-sheet snapshot. */
export interface BalanceEntry {
  readonly section: BalanceSection;
  readonly key: string;
  readonly name: string;
  /** Stored as-is (sign preserved); display-time positivity is the view's responsibility. */
  readonly amount: number;
  readonly notes?: string;
}

/** The balance sheet as of one date. */
export interface BalanceSheetSnapshot {
  readonly id: string;
  readonly asOfDate: string;
  readonly sourceIds: readonly string[];
  readonly entries: readonly BalanceEntry[];
  readonly notes?: string;
}

/** Manually entered liquidity inputs captured at one named date. */
export interface LiquidityBaselineRecord {
  readonly id: string;
  readonly asOfDate: string;
  readonly currentCash: number;
  readonly trailing12mOperatingCosts: number;
  readonly currentAnnualRepairCollection: number;
  readonly sourceIds: readonly string[];
  readonly notes?: string;
}

/** A building component is descriptive metadata, not an event generator. */
export interface Asset {
  readonly id: string;
  readonly name: string;
  readonly category: AssetCategory;
  readonly sourceIds: readonly string[];
  readonly active: boolean;
}

export interface Observation {
  readonly id: string;
  readonly assetId: string;
  readonly observedAt: string;
  readonly description: string;
  readonly sourceIds: readonly string[];
}

export interface CostEvidence {
  readonly id: string;
  readonly assetId?: string;
  readonly eventId?: string;
  readonly status: CostEvidenceStatus;
  readonly amount?: number;
  readonly unit: string;
  readonly quantity?: number;
  readonly priceLevelYear: number;
  readonly vatIncluded?: boolean | null;
  readonly observedAt?: string | null;
  readonly validUntil?: string | null;
  readonly sourceUrl?: string;
  readonly sourceId?: string;
  readonly notes?: string;
}

export interface PriceLevelConfirmation {
  readonly costEvidenceId: string;
  readonly targetYear: typeof PROJECTION_PRICE_LEVEL_YEAR;
  readonly confirmedAt: string;
  readonly confirmedBy: string;
}

/**
 * One exact scenario row entered manually or imported from a reviewed source. Several rows may share the same scenario and event.
 */
export interface EventScheduleEntry {
  readonly id: string;
  readonly scenario: Scenario;
  readonly year: number;
  readonly amount?: number;
  readonly quantity?: number;
  readonly costEvidenceId: string;
  readonly explanation?: string;
}

export interface ActualEventEntry {
  readonly year: number;
  readonly occurredAt?: string;
  readonly amount?: number;
  readonly quantity?: number;
  readonly costEvidenceId: string;
}

interface BuildingEventBase {
  readonly id: string;
  readonly assetId: string;
  readonly title: string;
  readonly type: EventType;
  readonly origin: EventOrigin;
  readonly sourceIds: readonly string[];
  readonly observationIds?: readonly string[];
  readonly notes?: string;
}

export interface FutureBuildingEvent extends BuildingEventBase {
  readonly status: "suggested" | "approved";
  /** Exact rows only. No dates or costs are generated from lifecycle rules. */
  readonly schedule: readonly EventScheduleEntry[];
}

export interface ActualBuildingEvent extends BuildingEventBase {
  readonly status: "actual";
  readonly actual: ActualEventEntry;
}

export interface CancelledBuildingEvent extends BuildingEventBase {
  readonly status: "cancelled";
  readonly schedule?: readonly EventScheduleEntry[];
}

export type BuildingEvent =
  | FutureBuildingEvent
  | ActualBuildingEvent
  | CancelledBuildingEvent;

export interface ProjectedCostEvent {
  readonly id: string;
  readonly eventId: string;
  readonly scheduleEntryId: string;
  readonly assetId: string;
  readonly title: string;
  readonly type: EventType;
  readonly origin: EventOrigin;
  readonly scenario: Scenario;
  readonly year: number;
  readonly amount: number;
  readonly quantity?: number;
  readonly costEvidenceId: string;
  readonly observationIds?: readonly string[];
  readonly explanation: string;
}

export interface HorizonEventSummary {
  readonly events: readonly ProjectedCostEvent[];
  readonly eventCount: number;
  readonly quantity: number;
  readonly amount: number;
}

export type HorizonSummaryByScenario = Readonly<
  Record<Scenario, HorizonEventSummary>
>;

export type HorizonPosition = "before" | "within" | "after";

export interface EventDataGap {
  readonly eventId: string;
  readonly scheduleEntryId: string;
  readonly assetId: string;
  readonly title: string;
  readonly scenario: Scenario;
  readonly year: number;
  readonly quantity?: number;
  readonly costEvidenceId: string;
  readonly horizonPosition: HorizonPosition;
  readonly reason: string;
}

export interface EventPortfolioResult {
  readonly events: readonly ProjectedCostEvent[];
  readonly beforeHorizon: HorizonSummaryByScenario;
  readonly afterHorizon: HorizonSummaryByScenario;
  /** Approved rows with a named DATA GAP; never converted to zero euros. */
  readonly dataGaps: readonly EventDataGap[];
  readonly history: readonly ActualBuildingEvent[];
  readonly suggestions: readonly FutureBuildingEvent[];
  readonly cancelled: readonly CancelledBuildingEvent[];
}

/** One scenario's numeric rows and named DATA GAPs for one horizon year. */
export interface YearProjection {
  readonly year: number;
  readonly eventCount: number;
  readonly quantity: number;
  readonly amount: number;
  readonly events: readonly ProjectedCostEvent[];
  readonly dataGaps: readonly EventDataGap[];
}

export interface ScenarioDataGapSummary {
  readonly beforeHorizon: readonly EventDataGap[];
  readonly withinHorizon: readonly EventDataGap[];
  readonly afterHorizon: readonly EventDataGap[];
}

export interface ScenarioProjection {
  readonly scenario: Scenario;
  readonly years: readonly YearProjection[];
  readonly horizonEventCount: number;
  readonly horizonQuantity: number;
  readonly horizonAmount: number;
  readonly beforeHorizonEventCount: number;
  readonly beforeHorizonQuantity: number;
  readonly beforeHorizonAmount: number;
  readonly afterHorizonEventCount: number;
  readonly afterHorizonQuantity: number;
  readonly afterHorizonAmount: number;
  readonly dataGaps: ScenarioDataGapSummary;
}

export interface ProjectionResult {
  readonly scenarios: Readonly<Record<Scenario, ScenarioProjection>>;
  /** All named gaps, including before/within/after horizon positions. */
  readonly dataGaps: readonly EventDataGap[];
  readonly history: readonly ActualBuildingEvent[];
  readonly suggestions: readonly FutureBuildingEvent[];
  readonly cancelled: readonly CancelledBuildingEvent[];
}


export const EVENT_CHANGE_TYPES = ["add", "update", "cancel"] as const;
export type EventChangeType = (typeof EVENT_CHANGE_TYPES)[number];

export const EVENT_CHANGE_PROPOSAL_STATUSES = [
  "pending",
  "accepted",
  "rejected",
] as const;
export type EventChangeProposalStatus =
  (typeof EVENT_CHANGE_PROPOSAL_STATUSES)[number];

export type EventProposalDecisionValue = "accept" | "reject";

/**
 * One reviewed change proposal. Updates and cancellations carry the target
 * fingerprint captured when the proposal was created, so stale proposals
 * cannot overwrite a later edit.
 */
export interface EventChangeProposal {
  readonly id: string;
  readonly changeType: EventChangeType;
  readonly sourceIds: readonly string[];
  readonly explanation: string;
  readonly createdAt: string;
  readonly status: EventChangeProposalStatus;
  readonly targetEventId?: string;
  readonly expectedTargetFingerprint?: string;
  readonly proposedEvent?: FutureBuildingEvent;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
}

export interface EventChangeCandidate {
  readonly id: string;
  readonly changeType: EventChangeType;
  readonly sourceIds: readonly string[];
  readonly explanation: string;
  readonly createdAt: string;
  readonly targetEventId?: string;
  readonly proposedEvent?: FutureBuildingEvent;
}

export interface EventProposalDiffResult {
  readonly proposals: readonly EventChangeProposal[];
  readonly unchangedCandidateIds: readonly string[];
}

export interface EventProposalDecision {
  readonly proposalId: string;
  readonly decision: EventProposalDecisionValue;
  readonly decidedAt: string;
  readonly decidedBy: string;
}

export interface EventChangeAuditEntry {
  readonly id: string;
  readonly proposalId: string;
  readonly decision: EventProposalDecisionValue;
  readonly changeType: EventChangeType;
  readonly decidedAt: string;
  readonly decidedBy: string;
  readonly sourceIds: readonly string[];
  readonly explanation: string;
  readonly targetEventId?: string;
  readonly beforeEvent?: BuildingEvent;
  readonly afterEvent?: BuildingEvent;
}

export interface EventReviewState {
  readonly events: readonly BuildingEvent[];
  readonly proposals: readonly EventChangeProposal[];
  readonly auditTrail: readonly EventChangeAuditEntry[];
}

export interface ReviewFlag {
  readonly id: string;
  readonly type:
    | "population_failure_rate"
    | "project_reschedule"
    | "cost_refresh"
    | "manual_review";
  readonly status: "open" | "acknowledged" | "resolved";
  readonly assetId?: string;
  readonly eventId?: string;
  readonly message: string;
  readonly createdAt: string;
}



export const ADMIN_ENTITY_TYPES = [
  "housing_company",
  "financial_year",
  "liquidity_baseline",
  "asset",
  "observation",
  "cost_evidence",
  "price_level_confirmation",
  "building_event",
  "financial_account",
  "financial_entry",
  "balance_sheet_snapshot",
  "group_budget",
] as const;
export type AdminEntityType = (typeof ADMIN_ENTITY_TYPES)[number];

export type AdminOperationType = "create" | "update" | "delete";

/**
 * Every entity type a delete_entity operation may target. `housing_company`
 * is deliberately absent: validateAdminDataSnapshot requires the snapshot's
 * housingCompany to exist and to match companyId, so deleting it could only
 * ever produce an invalid snapshot.
 */
export const DELETABLE_ADMIN_ENTITY_TYPES = ADMIN_ENTITY_TYPES.filter(
  (entityType) => entityType !== "housing_company",
) as readonly Exclude<AdminEntityType, "housing_company">[];
export type DeletableAdminEntityType = (typeof DELETABLE_ADMIN_ENTITY_TYPES)[number];

export type AdminEntitySnapshot =
  | HousingCompany
  | FinancialYear
  | LiquidityBaselineRecord
  | Asset
  | Observation
  | CostEvidence
  | PriceLevelConfirmation
  | BuildingEvent
  | FinancialAccount
  | FinancialEntry
  | BalanceSheetSnapshot
  | GroupBudget;

export interface AdminAuditEntry {
  readonly id: string;
  readonly revision: number;
  readonly entityType: AdminEntityType;
  readonly entityKey: string;
  readonly operation: AdminOperationType;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly sourceIds: readonly string[];
  readonly explanation: string;
  readonly before?: AdminEntitySnapshot;
  /**
   * Absent only on a `delete` entry, where the entity no longer exists after
   * the operation — `before` then carries the removed value. Every create and
   * update entry has one.
   */
  readonly after?: AdminEntitySnapshot;
}

export interface AdminDataSnapshot {
  readonly companyId: string;
  readonly revision: number;
  readonly housingCompany: HousingCompany;
  readonly financialYears: readonly FinancialYear[];
  readonly liquidityBaselines: readonly LiquidityBaselineRecord[];
  readonly assets: readonly Asset[];
  readonly observations: readonly Observation[];
  readonly costEvidence: readonly CostEvidence[];
  readonly priceLevelConfirmations: readonly PriceLevelConfirmation[];
  readonly events: readonly BuildingEvent[];
  readonly financialAccounts: readonly FinancialAccount[];
  readonly financialEntries: readonly FinancialEntry[];
  readonly balanceSheetSnapshots: readonly BalanceSheetSnapshot[];
  readonly groupBudgets: readonly GroupBudget[];
  readonly auditTrail: readonly AdminAuditEntry[];
  readonly updatedAt: string;
  readonly updatedBy: string;
}

interface AdminOperationMetadata {
  readonly sourceIds: readonly string[];
  readonly explanation: string;
}

export type AdminDataOperation =
  | ({ readonly type: "save_housing_company"; readonly value: HousingCompany } & AdminOperationMetadata)
  | ({ readonly type: "save_financial_year"; readonly value: FinancialYear } & AdminOperationMetadata)
  | ({ readonly type: "save_liquidity_baseline"; readonly value: LiquidityBaselineRecord } & AdminOperationMetadata)
  | ({ readonly type: "save_asset"; readonly value: Asset } & AdminOperationMetadata)
  | ({ readonly type: "save_observation"; readonly value: Observation } & AdminOperationMetadata)
  | ({ readonly type: "save_cost_evidence"; readonly value: CostEvidence } & AdminOperationMetadata)
  | ({ readonly type: "save_price_level_confirmation"; readonly value: PriceLevelConfirmation } & AdminOperationMetadata)
  | ({ readonly type: "save_building_event"; readonly value: BuildingEvent } & AdminOperationMetadata)
  | ({ readonly type: "save_financial_account"; readonly value: FinancialAccount } & AdminOperationMetadata)
  | ({ readonly type: "save_financial_entry"; readonly value: FinancialEntry } & AdminOperationMetadata)
  | ({ readonly type: "save_balance_sheet_snapshot"; readonly value: BalanceSheetSnapshot } & AdminOperationMetadata)
  | ({ readonly type: "save_group_budget"; readonly value: GroupBudget } & AdminOperationMetadata)
  | ({
      readonly type: "delete_entity";
      readonly entityType: DeletableAdminEntityType;
      readonly entityKey: string;
    } & AdminOperationMetadata);

export interface AdminDataBatchCommand {
  readonly companyId: string;
  readonly expectedRevision: number;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly operations: readonly AdminDataOperation[];
}

/** Approved future events and actual history are the only event states exposed in a publication. */
export type PublishedBuildingEvent =
  | (Omit<FutureBuildingEvent, "status"> & { readonly status: "approved" })
  | ActualBuildingEvent;

/** Immutable public version created from one exact admin workspace revision. */
export interface PublishedDataSnapshot {
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly sourceAdminRevision: number;
  readonly contentFingerprint: string;
  readonly housingCompany: HousingCompany;
  readonly financialYears: readonly FinancialYear[];
  readonly liquidityBaselines: readonly LiquidityBaselineRecord[];
  readonly assets: readonly Asset[];
  readonly observations: readonly Observation[];
  readonly costEvidence: readonly CostEvidence[];
  readonly priceLevelConfirmations: readonly PriceLevelConfirmation[];
  readonly events: readonly PublishedBuildingEvent[];
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly sourceIds: readonly string[];
  readonly explanation: string;
}

export interface PublishAdminDataCommand {
  readonly companyId: string;
  readonly expectedAdminRevision: number;
  /** Zero when the company has never been published. */
  readonly expectedPublishedVersion: number;
  readonly publishedAt: string;
  readonly publishedBy: string;
  readonly sourceIds: readonly string[];
  readonly explanation: string;
}

/** Read model returned to a visitor; it never contains drafts, cancellations, or admin audit data. */
export interface VisitorPublishedView {
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly sourceAdminRevision: number;
  readonly publishedAt: string;
  readonly housingCompany: HousingCompany;
  readonly financialYears: readonly FinancialYear[];
  readonly latestLiquidityBaseline?: LiquidityBaselineRecord;
  readonly assets: readonly Asset[];
  readonly observations: readonly Observation[];
  readonly costEvidence: readonly CostEvidence[];
  readonly priceLevelConfirmations: readonly PriceLevelConfirmation[];
  readonly approvedEvents: readonly (Omit<FutureBuildingEvent, "status"> & { readonly status: "approved" })[];
  readonly actualHistory: readonly ActualBuildingEvent[];
}

export const DEFAULT_OPERATING_BUFFER_MONTHS = 3.5 as const;

export type OperatingBufferBasis = "suggested" | "user_override";

export interface OperatingBufferResult {
  readonly bufferMonths: number;
  readonly suggestedOperatingBuffer: number;
  readonly operatingBufferTarget: number;
  readonly basis: OperatingBufferBasis;
}

/**
 * One cash-path year.
 *
 * Every field that depends on the year's repair costs is `undefined` - never
 * zero - once the year lies beyond the maintenance plan's coverage. An
 * unplanned year is unknown, not free: rendering it as 0,00 EUR would make
 * "nothing is planned" and "nothing is known" look identical, and the second
 * one is the dangerous half. `costsKnown` says which case this row is, so a
 * genuine zero inside the covered range stays a zero.
 */
export interface CashPathYear {
  readonly year: number;
  /**
   * Known for every covered year, and for the first uncovered year, whose
   * opening cash is the last covered year's closing cash. Unknown after that:
   * the chain breaks exactly once, where the knowledge does.
   */
  readonly openingCash?: number;
  readonly annualRepairCollection: number;
  readonly knownRepairCosts?: number;
  readonly closingCash?: number;
  readonly operatingBufferTarget: number;
  readonly cashAboveBuffer?: number;
  readonly bufferShortfall?: number;
  readonly dataGaps?: readonly EventDataGap[];
  /** False when the year is beyond the maintenance plan's coverage. */
  readonly costsKnown: boolean;
}

export interface ScenarioCashPath {
  readonly scenario: Scenario;
  readonly years: readonly CashPathYear[];
  readonly initialCash: number;
  readonly annualRepairCollection: number;
  readonly operatingBufferTarget: number;
  /** Summed over covered years only; uncovered years contribute unknowns. */
  readonly knownRepairCostsTotal: number;
  /** Collection is a known input every year, so this spans the whole horizon. */
  readonly collectionTotal: number;
  /** Undefined when the plan's coverage ends before the horizon does. */
  readonly finalCash?: number;
  /** Unknown-cost rows before or within the planning horizon. */
  readonly blockingDataGaps: readonly EventDataGap[];
  /** Echoed from the housing company so views can caption the table. */
  readonly maintenancePlanCoverageThroughYear?: number;
  /** Present only when the horizon reaches past the plan's coverage. */
  readonly beyondCoverage?: BeyondCoverageSummary;
}

/**
 * What the cash path deliberately stops computing past the coverage year.
 *
 * Some events are already scheduled into those years (the water-heater
 * replacement runs to 2039 against a plan covering 2030). Their amounts are
 * left out of the cash path - a year's total cost is unknown even when one of
 * its rows is known - but they are counted here so the omission is stated
 * rather than silent.
 */
export interface BeyondCoverageSummary {
  readonly firstYear: number;
  readonly yearCount: number;
  readonly scheduledCostTotal: number;
}

export interface FundingNeedSignal {
  readonly scenario: Scenario;
  readonly ownFundingSufficientForKnownCosts: boolean;
  readonly forecastComplete: boolean;
  readonly amountAtFirstNeed: number;
  readonly maximumBufferShortfall: number;
  readonly minimumClosingCash: number;
  readonly blockingDataGaps: readonly EventDataGap[];
  readonly firstFundingNeedYear?: number;
}

export interface RequiredCollectionResult {
  readonly scenario: Scenario;
  /** Minimum flat annual collection for known numeric costs only. */
  readonly knownCostRequiredAnnualCollection: number;
  readonly currentAnnualRepairCollection: number;
  readonly additionalAnnualCollection: number;
  readonly currentMonthlyCollection: number;
  readonly requiredMonthlyCollection: number;
  readonly additionalMonthlyCollection: number;
  readonly planningYearCount: number;
  readonly forecastComplete: boolean;
  readonly blockingDataGaps: readonly EventDataGap[];
  readonly currentMonthlyPerM2?: number;
  readonly requiredMonthlyPerM2?: number;
  readonly additionalMonthlyPerM2?: number;
  readonly currentMonthlyPerApartment?: number;
  readonly requiredMonthlyPerApartment?: number;
  readonly additionalMonthlyPerApartment?: number;
}

export interface ScenarioLiquidityForecast {
  readonly cashPath: ScenarioCashPath;
  readonly fundingNeed: FundingNeedSignal;
  readonly requiredCollection: RequiredCollectionResult;
}

export interface LiquidityForecastResult {
  readonly operatingBuffer: OperatingBufferResult;
  readonly scenarios: Readonly<Record<Scenario, ScenarioLiquidityForecast>>;
}


/** Visitor session changes are ephemeral deltas over one immutable publication. */
export interface SessionEventOverride {
  readonly id: string;
  readonly eventId: string;
  readonly scheduleEntryId: string;
  readonly excluded?: boolean;
  readonly year?: number;
  /** null explicitly changes a numeric row into a named session DATA GAP. */
  readonly amount?: number | null;
  /** null explicitly clears an optional quantity. */
  readonly quantity?: number | null;
  readonly explanation?: string;
}

export interface SessionCustomScheduleEntry {
  readonly id: string;
  readonly scenario: Scenario;
  readonly year: number;
  /** Undefined means a named session DATA GAP, never a silent zero. */
  readonly amount?: number;
  readonly quantity?: number;
  readonly explanation?: string;
}

export interface SessionCustomEvent {
  readonly id: string;
  readonly assetId: string;
  readonly title: string;
  readonly type: EventType;
  readonly schedule: readonly SessionCustomScheduleEntry[];
  readonly notes?: string;
}

export interface SessionLiquidityOverrides {
  readonly currentCash?: number;
  readonly trailing12mOperatingCosts?: number;
  readonly bufferMonths?: number;
  /** null removes a published user override and uses the month-based buffer. */
  readonly operatingBufferTarget?: number | null;
  readonly totalChargeableAreaM2?: number;
  readonly apartmentCount?: number;
  readonly annualRepairCollectionByScenario?: Partial<
    Readonly<Record<Scenario, number>>
  >;
}

export interface VisitorSessionWorkspace {
  readonly sessionId: string;
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly publicationFingerprint: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly baseHorizon: Horizon;
  readonly horizon: Horizon;
  readonly eventOverrides: readonly SessionEventOverride[];
  readonly customEvents: readonly SessionCustomEvent[];
  readonly liquidityOverrides: SessionLiquidityOverrides;
}

export interface CreateVisitorSessionCommand {
  readonly sessionId: string;
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly horizon: Horizon;
}

export type VisitorSessionOperation =
  | { readonly type: "save_event_override"; readonly value: SessionEventOverride }
  | { readonly type: "remove_event_override"; readonly overrideId: string }
  | { readonly type: "save_custom_event"; readonly value: SessionCustomEvent }
  | { readonly type: "remove_custom_event"; readonly customEventId: string }
  | { readonly type: "set_horizon"; readonly value: Horizon }
  | { readonly type: "set_liquidity_overrides"; readonly value: SessionLiquidityOverrides }
  | { readonly type: "reset_workspace" };

export interface VisitorSessionBatchCommand {
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly occurredAt: string;
  readonly operations: readonly VisitorSessionOperation[];
}

export interface EffectiveSessionData {
  readonly assets: readonly Asset[];
  readonly events: readonly BuildingEvent[];
  readonly costEvidence: readonly CostEvidence[];
  readonly priceLevelConfirmations: readonly PriceLevelConfirmation[];
}

export interface EffectiveSessionLiquidityAssumptions {
  readonly currentCash: number;
  readonly trailing12mOperatingCosts: number;
  readonly operatingBufferSettings: OperatingBufferSettings;
  readonly totalChargeableAreaM2?: number;
  readonly apartmentCount?: number;
  readonly annualRepairCollectionByScenario: Readonly<Record<Scenario, number>>;
}

export type SessionLiquidityModel =
  | {
      readonly status: "available";
      readonly assumptions: EffectiveSessionLiquidityAssumptions;
      readonly forecast: LiquidityForecastResult;
    }
  | {
      readonly status: "unavailable";
      readonly missingFields: readonly (
        | "currentCash"
        | "trailing12mOperatingCosts"
        | "currentAnnualRepairCollection"
      )[];
    };

export interface VisitorSessionModel {
  readonly sessionId: string;
  readonly sessionRevision: number;
  readonly companyId: string;
  readonly publicationVersion: number;
  readonly publicationFingerprint: string;
  readonly horizon: Horizon;
  readonly effectiveApprovedEvents: readonly FutureBuildingEvent[];
  readonly projection: ProjectionResult;
  readonly liquidity: SessionLiquidityModel;
  readonly modificationCount: number;
}

export type ValidationCode =
  | "INVALID_HORIZON"
  | "DUPLICATE_ASSET_ID"
  | "DUPLICATE_EVENT_ID"
  | "DUPLICATE_SCHEDULE_ENTRY_ID"
  | "DUPLICATE_COST_EVIDENCE_ID"
  | "MISSING_ASSET"
  | "INACTIVE_ASSET"
  | "MISSING_EVENT_SOURCE"
  | "INVALID_EVENT_SCHEDULE"
  | "INVALID_EVENT_YEAR"
  | "INVALID_EVENT_QUANTITY"
  | "INVALID_EVENT_AMOUNT"
  | "MISSING_COST_EVIDENCE"
  | "COST_EVIDENCE_MISMATCH"
  | "MISSING_COST_SOURCE"
  | "UNCONFIRMED_PRICE_LEVEL"
  | "INVALID_DATA_GAP"
  | "INVALID_OPERATING_BUFFER"
  | "INVALID_CASH_INPUT"
  | "INVALID_COLLECTION_INPUT"
  | "INVALID_SCENARIO_PROJECTION"
  | "INVALID_MAINTENANCE_PLAN_COVERAGE"
  | "INVALID_CHARGE_BASIS"
  | "DUPLICATE_CHANGE_PROPOSAL_ID"
  | "INVALID_CHANGE_PROPOSAL"
  | "MISSING_CHANGE_SOURCE"
  | "MISSING_TARGET_EVENT"
  | "CHANGE_PROPOSAL_CONFLICT"
  | "CHANGE_PROPOSAL_ALREADY_DECIDED"
  | "INVALID_ADMIN_DATA"
  | "INVALID_ADMIN_OPERATION"
  | "DUPLICATE_ADMIN_OPERATION"
  | "DELETE_TARGET_NOT_FOUND"
  | "ADMIN_DATA_NOT_FOUND"
  | "ADMIN_DATA_ALREADY_EXISTS"
  | "ADMIN_REVISION_CONFLICT"
  | "PUBLISHED_DATA_NOT_FOUND"
  | "PUBLISHED_VERSION_CONFLICT"
  | "INVALID_PUBLISHED_DATA"
  | "NO_PUBLICATION_CHANGES"
  | "INVALID_SESSION_DATA"
  | "SESSION_NOT_FOUND"
  | "SESSION_ALREADY_EXISTS"
  | "SESSION_REVISION_CONFLICT"
  | "SESSION_EXPIRED"
  | "DATABASE_MIGRATION_CONFLICT"
  | "DATABASE_INTEGRITY_ERROR"
  | "SESSION_PUBLICATION_MISMATCH"
  | "UNAUTHENTICATED"
  | "INVALID_AUTH_CONTEXT"
  | "ACCESS_DENIED"
  | "INVALID_ACCESS_GRANT"
  | "INVALID_SESSION_CREDENTIAL";

export class DomainValidationError extends Error {
  public readonly code: ValidationCode;

  public constructor(code: ValidationCode, message: string) {
    super(message);
    this.name = "DomainValidationError";
    this.code = code;
  }
}
