import {
  SCENARIOS,
  type ActualBuildingEvent,
  type AdminDataSnapshot,
  type CostEvidenceStatus,
  type Scenario,
} from "../domain/types.js";
import { cashByClosingYear } from "../finance/balanceCash.js";
import {
  computeOperatingMarginSeries,
  type OperatingMarginYear,
} from "../finance/operatingFigures.js";
import { buildProjection } from "../projection/buildProjection.js";

/**
 * The cash path table (handoff feature/cashpath-rebuild §1): one row per
 * year the books can state, read left to right as one equation -
 * opening + hoitokate − repairs = closing - followed by two comparison
 * columns. It is a ledger, not a forecast.
 *
 * NOT projectCashPath. That function projects a constant collection over a
 * horizon and feeds findFundingNeed, calculateRequiredCollection and the
 * visitor session; it is a forecast and stays one. This read model reads
 * the closed years from the account data and balance sheets, and exactly
 * one kind of future: a year that has a budget. Nothing here is carried
 * forward from the latest year - the failure the old table had, where one
 * hoitokate appeared 32 times as if it were data.
 *
 * THREE QUALITIES OF DATA, THREE SHAPES. A closed year is an "actual" row, a
 * budgeted year a "budget" row, and a year with neither has no row at all.
 * `rowKind` is the discriminant and the renderer keys off it; it never
 * infers the quality from which cells happen to be filled. A budget row
 * must not look like an actual row, or a reader sees four rows of which
 * three are true and one is a forecast.
 *
 * Every money figure is a magnitude (repairs positive), and every cell that
 * has no source is `undefined`, never 0: 2023 has no balance sheet, so its
 * cash columns are empty, and when the 2022 sheet is entered they fill in.
 */
export interface CashPathActualRow {
  readonly rowKind: "actual";
  readonly year: number;
  /** Previous year's closing cash from its balance sheet. */
  readonly openingCash?: number;
  readonly operatingMargin: number;
  /** The repair group's actual for the year. */
  readonly repairs: number;
  /** This year's closing cash from its balance sheet. */
  readonly closingCash?: number;
  /** The repair group's budget for the year, when one was set. */
  readonly repairBudget?: number;
  /** Actual hoitokate minus budgeted hoitokate, when a budget exists. */
  readonly marginVsBudget?: number;
}

export interface CashPathBudgetRow {
  readonly rowKind: "budget";
  readonly year: number;
  readonly openingCash?: number;
  /** Budgeted hoitokate: budget income − (budget costs − budget repairs). */
  readonly operatingMargin: number;
  /** Approved repairs scheduled for the year in this scenario, known costs only. */
  readonly repairs: number;
  /** Approved rows for the year whose cost is a named DATA GAP. */
  readonly repairDataGapCount: number;
  /**
   * opening + margin − repairs, present only when the opening cash is from
   * a balance sheet and no DATA GAP sits in the year's repairs.
   */
  readonly closingCash?: number;
  readonly repairBudget: number;
}

export type CashPathTableRow = CashPathActualRow | CashPathBudgetRow;

/** One approved, scheduled repair in the banner under the table (§2). */
export interface KnownRepairRow {
  readonly year: number;
  readonly eventId: string;
  readonly scheduleEntryId: string;
  readonly assetId: string;
  readonly title: string;
  /** Absent for a DATA GAP. */
  readonly amount?: number;
  readonly quantity?: number;
  /** The cost evidence's status; "data_gap" when the cost is unknown. */
  readonly priceQuality: CostEvidenceStatus;
}

/** One completed repair (§2, "Toteutuneet"): the realised price only. */
export interface CompletedRepairRow {
  readonly year: number;
  readonly eventId: string;
  readonly assetId: string;
  readonly title: string;
  readonly occurredAt?: string;
  /**
   * ActualEventEntry.amount. Absent when the event was recorded against a
   * DATA GAP - the estimate it may once have had is never shown here.
   */
  readonly amount?: number;
}

export interface CashPathScenarioTable {
  readonly scenario: Scenario;
  readonly rows: readonly CashPathTableRow[];
  readonly knownRepairs: {
    readonly rows: readonly KnownRepairRow[];
    /** Sum of the rows with a known amount. */
    readonly total: number;
    readonly dataGapCount: number;
  };
}

export interface CashPathTableReadModel {
  readonly scenarios: Readonly<Record<Scenario, CashPathScenarioTable>>;
  /** Scenario-independent: what happened is not a scenario. */
  readonly completedRepairs: readonly CompletedRepairRow[];
  readonly latestActualYear?: number;
  readonly maintenancePlanCoverageThroughYear?: number;
}

export type CashPathTableSource = Pick<
  AdminDataSnapshot,
  | "housingCompany"
  | "financialAccounts"
  | "financialEntries"
  | "groupActuals"
  | "groupBudgets"
  | "balanceSheetSnapshots"
  | "assets"
  | "events"
  | "costEvidence"
  | "priceLevelConfirmations"
>;

export function buildCashPathTable(
  source: CashPathTableSource,
): CashPathTableReadModel {
  const actualSeries = computeOperatingMarginSeries(source, "actual");
  const budgetSeries = computeOperatingMarginSeries(source, "budget");
  const cash = cashByClosingYear(source.balanceSheetSnapshots);
  const latestActualYear = actualSeries.at(-1)?.year;
  const budgetByYear = new Map(budgetSeries.map((row) => [row.year, row]));

  // A budget year is a future the books have not yet closed. A budget for a
  // closed year is comparison data on that year's actual row, not a row.
  const budgetRows = budgetSeries.filter(
    (row) => latestActualYear === undefined || row.year > latestActualYear,
  );

  const projection = projectKnownRepairs(source, budgetRows.map((row) => row.year));
  const evidenceStatus = new Map(
    source.costEvidence.map((evidence) => [evidence.id, evidence.status]),
  );

  const scenarios = {} as Record<Scenario, CashPathScenarioTable>;
  for (const scenario of SCENARIOS) {
    const years = projection?.scenarios[scenario].years ?? [];
    const rows: CashPathTableRow[] = [
      ...actualSeries.map((year) => actualRow(year, cash, budgetByYear.get(year.year))),
      ...budgetRows.map((year): CashPathBudgetRow => {
        const projected = years.find((row) => row.year === year.year);
        const repairs = projected?.amount ?? 0;
        const repairDataGapCount = projected?.dataGaps.length ?? 0;
        const openingCash = cash.get(year.year - 1);
        const closingCash = openingCash === undefined || repairDataGapCount > 0
          ? undefined
          : round2(openingCash + year.operatingMargin - repairs);
        return {
          rowKind: "budget",
          year: year.year,
          ...(openingCash === undefined ? {} : { openingCash }),
          operatingMargin: year.operatingMargin,
          repairs,
          repairDataGapCount,
          ...(closingCash === undefined ? {} : { closingCash }),
          repairBudget: year.repairs,
        };
      }),
    ];

    const knownRows: KnownRepairRow[] = years.flatMap((year) => [
      ...year.events.map((event): KnownRepairRow => ({
        year: event.year,
        eventId: event.eventId,
        scheduleEntryId: event.scheduleEntryId,
        assetId: event.assetId,
        title: event.title,
        amount: event.amount,
        ...(event.quantity === undefined ? {} : { quantity: event.quantity }),
        priceQuality: evidenceStatus.get(event.costEvidenceId) ?? "estimate",
      })),
      ...year.dataGaps.map((gap): KnownRepairRow => ({
        year: gap.year,
        eventId: gap.eventId,
        scheduleEntryId: gap.scheduleEntryId,
        assetId: gap.assetId,
        title: gap.title,
        ...(gap.quantity === undefined ? {} : { quantity: gap.quantity }),
        priceQuality: "data_gap",
      })),
    ]).sort(
      (a, b) => a.year - b.year || a.title.localeCompare(b.title) ||
        a.scheduleEntryId.localeCompare(b.scheduleEntryId),
    );

    scenarios[scenario] = {
      scenario,
      rows,
      knownRepairs: {
        rows: knownRows,
        total: round2(knownRows.reduce((sum, row) => sum + (row.amount ?? 0), 0)),
        dataGapCount: knownRows.filter((row) => row.amount === undefined).length,
      },
    };
  }

  const completedRepairs = (projection?.history ?? historyOf(source))
    .map((event): CompletedRepairRow => ({
      year: event.actual.year,
      eventId: event.id,
      assetId: event.assetId,
      title: event.title,
      ...(event.actual.occurredAt === undefined ? {} : { occurredAt: event.actual.occurredAt }),
      ...(event.actual.amount === undefined ? {} : { amount: event.actual.amount }),
    }))
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));

  const coverage = source.housingCompany.maintenancePlanCoverageThroughYear;
  return {
    scenarios: {
      optimistic: scenarios.optimistic,
      base: scenarios.base,
      stress: scenarios.stress,
    },
    completedRepairs,
    ...(latestActualYear === undefined ? {} : { latestActualYear }),
    ...(coverage === undefined ? {} : { maintenancePlanCoverageThroughYear: coverage }),
  };
}

function actualRow(
  year: OperatingMarginYear,
  cash: ReadonlyMap<number, number>,
  budget: OperatingMarginYear | undefined,
): CashPathActualRow {
  const openingCash = cash.get(year.year - 1);
  const closingCash = cash.get(year.year);
  return {
    rowKind: "actual",
    year: year.year,
    ...(openingCash === undefined ? {} : { openingCash }),
    operatingMargin: year.operatingMargin,
    repairs: year.repairs,
    ...(closingCash === undefined ? {} : { closingCash }),
    ...(budget === undefined
      ? {}
      : {
          repairBudget: budget.repairs,
          marginVsBudget: round2(year.operatingMargin - budget.operatingMargin),
        }),
  };
}

/**
 * The projection over every year an approved row names, plus the budget
 * years - deliberately not the page's header horizon. The table and banner
 * describe the plan as entered, so changing a horizon selector elsewhere
 * must not add or drop rows here. Undefined when there is nothing to
 * project, so an empty company costs nothing.
 */
function projectKnownRepairs(
  source: CashPathTableSource,
  budgetYears: readonly number[],
) {
  const years = [...budgetYears];
  for (const event of source.events) {
    if (event.status !== "approved") continue;
    for (const entry of event.schedule) years.push(entry.year);
  }
  if (years.length === 0) return undefined;
  return buildProjection({
    assets: source.assets,
    events: source.events,
    costEvidence: source.costEvidence,
    priceLevelConfirmations: source.priceLevelConfirmations,
    horizon: { startYear: Math.min(...years), endYear: Math.max(...years) },
  });
}

function historyOf(source: CashPathTableSource): readonly ActualBuildingEvent[] {
  return source.events.filter(
    (event): event is ActualBuildingEvent => event.status === "actual",
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
