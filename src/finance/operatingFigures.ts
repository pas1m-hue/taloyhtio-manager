import type {
  FinancialAccountKind,
  FinancialAccountNature,
  OperatingCostFigures,
  OperatingFiguresUnavailable,
  OperatingFiguresUnavailableReason,
  OperatingMarginFigures,
} from "../domain/types.js";

export type {
  OperatingCostFigures,
  OperatingFiguresUnavailable,
  OperatingFiguresUnavailableReason,
  OperatingMarginFigures,
};

/**
 * The two operating figures the liquidity model needs, derived from account
 * data rather than hand-entered: the 12-month operating cost (the buffer
 * divisor) and the annual operating margin, "hoitokate".
 *
 * WHY THIS LIVES IN src/ AND NOT public/. The admin KPI used to compute the
 * first of these in the browser (adminOperationPayloads.js) while the
 * liquidity forecast read a hand-entered figure from the liquidity baseline,
 * so the same quantity existed as two numbers that disagreed: 37 567,84 on the
 * Taloudellinen asema card, 34 029,46 in the cash path and buffer target. The
 * forecast is built server-side for admin and visitor alike from one shared
 * composition (buildSnapshotCalculations), so the only place a single
 * implementation can serve both is here. The browser now renders what this
 * returns instead of computing its own.
 *
 * INPUT TYPES ARE DELIBERATELY NARROWER than the admin domain types. A
 * published snapshot carries only a projection of the account data (no account
 * names, no notes, no source ids - see publishedFinancialData.ts), and these
 * interfaces are exactly the fields both sides can supply. The full
 * AdminDataSnapshot collections are structurally assignable to them, so admin
 * passes its rows unchanged and no cast is needed anywhere.
 */

export interface CalculationFinancialAccount {
  readonly accountCode: string;
  readonly kind: FinancialAccountKind;
  readonly group: string;
  readonly nature?: FinancialAccountNature;
}

export interface CalculationFinancialEntry {
  readonly accountCode: string;
  readonly year: number;
  readonly actualAmount?: number;
  /** Admin-only: a publication never carries a budget figure. */
  readonly budgetAmount?: number;
}

export interface CalculationGroupActual {
  readonly group: string;
  readonly kind: FinancialAccountKind;
  readonly year: number;
  readonly actualAmount: number;
  readonly active: boolean;
}

export interface CalculationGroupBudget {
  readonly group: string;
  readonly kind: FinancialAccountKind;
  readonly year: number;
  readonly budgetAmount: number;
  readonly active: boolean;
}

export interface FinancialActualsSource {
  readonly financialAccounts: readonly CalculationFinancialAccount[];
  readonly financialEntries: readonly CalculationFinancialEntry[];
  readonly groupActuals: readonly CalculationGroupActual[];
}

/**
 * The actuals source plus the budget side of the same account data. The
 * budget collections are optional so a FinancialActualsSource (a publication,
 * say) still satisfies it: a missing budget side yields an empty budget
 * series, never a zero.
 */
export interface FinancialFiguresSource extends FinancialActualsSource {
  readonly groupBudgets?: readonly CalculationGroupBudget[];
}

/** Which of an entry's two figures a series is built from. */
export type FigureSide = "actual" | "budget";

/** Group whose costs are repairs; matched by name as the account data spells it. */
const REPAIR_GROUP_NAME = "KORJAUKSET";

/**
 * The buffer divisor.
 *
 * The asymmetry is deliberate and predates this module (handoff
 * feature/trailing-12m §1): every stable group contributes its latest actual
 * year, but repairs contribute a multi-year mean, because repairs do not
 * follow the accounting year - a water-heater replacement budgeted for three
 * years running and done in none of them makes any single year meaningless.
 *
 * A missing repair group is never silently zero. Zero repairs would shrink the
 * divisor and make months-of-cash look better than it is, which is the wrong
 * direction to be wrong in, so the result is unavailable with a named reason.
 */
export function computeOperatingCostFigures(
  source: FinancialActualsSource,
): OperatingCostFigures | OperatingFiguresUnavailable {
  const series = buildActualSeries(source, "expense");
  if (series.years.length === 0) return unavailable("no_expense_actuals");

  const repairGroups = series.groups.filter((group) => group.isRepair);
  if (repairGroups.length === 0) return unavailable("repair_group_missing");

  const repairByYear = new Map<number, number>();
  for (const year of series.years) {
    const total = sumPresent(repairGroups, year);
    if (total !== undefined) repairByYear.set(year, total);
  }
  if (repairByYear.size === 0) return unavailable("repair_group_missing");

  const latestActualYear = series.years[series.years.length - 1]!;
  const latestRepairs = repairByYear.get(latestActualYear);
  if (latestRepairs === undefined) {
    return unavailable("repair_actual_missing_for_latest_year");
  }
  const latestTotal = sumPresent(series.groups, latestActualYear) ?? 0;

  const repairYears = [...repairByYear.keys()].sort((a, b) => a - b);
  const repairSum = repairYears
    .reduce((sum, year) => sum + repairByYear.get(year)!, 0);

  // Costs are stored negative, so both of these are magnitudes rather than
  // signed amounts: the divisor is a quantity of money, not a direction.
  const costsExcludingRepairs = round2(Math.abs(latestTotal - latestRepairs));
  const repairAverage = round2(Math.abs(repairSum / repairYears.length));

  return {
    status: "available",
    latestActualYear,
    costsExcludingRepairs,
    repairAverage,
    repairYears,
    trailing12mOperatingCosts: round2(costsExcludingRepairs + repairAverage),
  };
}

/**
 * Hoitokate: what one year of operating income leaves after one year of
 * operating costs.
 *
 * Repairs are subtracted out of the costs because the cash path already
 * carries them as its own line, drawn from approved repair events. Counting
 * them here as well would charge them twice.
 *
 * Both halves are read for the same year, and that year is the expense side's
 * latest actual - the same year the divisor above is stated in, so the two
 * figures a reader sees together always describe one accounting year. An
 * income actual missing for that year is a DATA GAP, never a zero: zero income
 * against real costs would invent a deficit.
 */
export function computeOperatingMarginFigures(
  source: FinancialActualsSource,
): OperatingMarginFigures | OperatingFiguresUnavailable {
  const costs = computeOperatingCostFigures(source);
  if (costs.status === "unavailable") return costs;

  const income = buildActualSeries(source, "income");
  if (income.years.length === 0) return unavailable("no_income_actuals");
  const latestIncome = sumPresent(income.groups, costs.latestActualYear);
  if (latestIncome === undefined) {
    return unavailable("income_missing_for_latest_year");
  }

  return {
    status: "available",
    latestActualYear: costs.latestActualYear,
    income: round2(latestIncome),
    costsExcludingRepairs: costs.costsExcludingRepairs,
    operatingMargin: round2(latestIncome - costs.costsExcludingRepairs),
  };
}

/** One year's hoitokate and the parts it was made from. */
export interface OperatingMarginYear {
  readonly year: number;
  readonly income: number;
  /** Magnitude, like OperatingCostFigures.costsExcludingRepairs. */
  readonly costsExcludingRepairs: number;
  /** The repair group's figure for the year, as a magnitude. */
  readonly repairs: number;
  /** income - costsExcludingRepairs. */
  readonly operatingMargin: number;
}

/**
 * Hoitokate for every year the account data can state one, on either side
 * of the entries (feature/cashpath-rebuild §1). This is the per-year form of
 * computeOperatingMarginFigures - the same formula, the same group-level
 * precedence, the same repair-group detection - and the cash path table
 * reads its history from here rather than repeating the latest year's
 * figure down every row, which is what the old table did.
 *
 * A year is stated only when all three parts report: income, expenses and
 * the repair group. A year with expenses but no repair row would otherwise
 * read as "zero repairs", and a year with costs but no income as a deficit
 * the size of the costs. Both are the DATA GAP principle in reverse, so such
 * a year is simply absent from the series and the caller shows no row.
 *
 * The budget side reads FinancialEntry.budgetAmount and GroupBudget rows
 * (group wins, spec §6.4). A year without a group budget falls back to the
 * account sum for every group - verified against production 2026, where
 * only account budgets exist: 42 714,26 - (43 470,09 - 9 680,00) = 8 924,17.
 */
export function computeOperatingMarginSeries(
  source: FinancialFiguresSource,
  side: FigureSide,
): readonly OperatingMarginYear[] {
  const expenses = buildFigureSeries(source, "expense", side);
  const income = buildFigureSeries(source, "income", side);
  const repairGroups = expenses.groups.filter((group) => group.isRepair);
  const result: OperatingMarginYear[] = [];
  for (const year of expenses.years) {
    const repairs = sumPresent(repairGroups, year);
    const expenseTotal = sumPresent(expenses.groups, year);
    const yearIncome = sumPresent(income.groups, year);
    if (repairs === undefined || expenseTotal === undefined ||
        yearIncome === undefined) {
      continue;
    }
    const costsExcludingRepairs = round2(Math.abs(expenseTotal - repairs));
    result.push({
      year,
      income: round2(yearIncome),
      costsExcludingRepairs,
      repairs: round2(Math.abs(repairs)),
      operatingMargin: round2(yearIncome - costsExcludingRepairs),
    });
  }
  return result;
}

interface ActualGroup {
  readonly group: string;
  readonly isRepair: boolean;
  readonly actualByYear: ReadonlyMap<number, number>;
}

interface ActualSeries {
  /** Ascending, and only years some group actually reports. */
  readonly years: readonly number[];
  readonly groups: readonly ActualGroup[];
}

/**
 * One kind's actuals per group per year, with a group-level actual taking
 * precedence over the sum of that group's accounts (PR #19).
 *
 * Both kinds go through here, which is the point: income totals have honoured
 * group-level actuals since #19 while the cost side did not, so a hoitokate
 * built from the two would have subtracted one definition of "actual" from
 * another. 2023 income is 36 237,38 from the group level against 3 527,50 from
 * the accounts that happen to be imported - a difference far too large to let
 * the two halves disagree about.
 */
function buildActualSeries(
  source: FinancialActualsSource,
  kind: FinancialAccountKind,
): ActualSeries {
  return buildFigureSeries(source, kind, "actual");
}

/**
 * The same series for either side of the entries. The budget side follows the
 * precedence rule Budjetti vs. toteuma states in its own column (spec §6.4):
 * an active group-level budget wins over the sum of the group's accounts,
 * row by row - the mirror image of the group-actual rule above, and kept in
 * the same function so the two sides cannot drift apart in how they read a
 * group.
 */
function buildFigureSeries(
  source: FinancialFiguresSource,
  kind: FinancialAccountKind,
  side: FigureSide,
): ActualSeries {
  const accounts = source.financialAccounts.filter(
    (account) => account.kind === kind,
  );
  const accountsByCode = new Map(
    accounts.map((account) => [account.accountCode, account]),
  );

  /** group -> year -> summed account actuals */
  const accountTotals = new Map<string, Map<number, number>>();
  /** group -> accounts that carry at least one actual, for repair detection */
  const reportingAccounts = new Map<string, CalculationFinancialAccount[]>();
  const years = new Set<number>();

  for (const entry of source.financialEntries) {
    const account = accountsByCode.get(entry.accountCode);
    if (account === undefined) continue;
    const amount = side === "actual" ? entry.actualAmount : entry.budgetAmount;
    if (typeof amount !== "number" || !Number.isFinite(amount)) continue;
    if (!Number.isInteger(entry.year)) continue;

    years.add(entry.year);
    const byYear = accountTotals.get(account.group) ?? new Map<number, number>();
    byYear.set(entry.year, (byYear.get(entry.year) ?? 0) + amount);
    accountTotals.set(account.group, byYear);

    const reporting = reportingAccounts.get(account.group) ?? [];
    if (!reporting.includes(account)) reporting.push(account);
    reportingAccounts.set(account.group, reporting);
  }

  /** group -> year -> group-level figure, which overrides the account sum */
  const groupLevel = new Map<string, Map<number, number>>();
  const groupFigures: readonly { group: string; kind: FinancialAccountKind; year: number; amount: number; active: boolean }[] =
    side === "actual"
      ? source.groupActuals.map((row) => ({ ...row, amount: row.actualAmount }))
      : (source.groupBudgets ?? []).map((row) => ({ ...row, amount: row.budgetAmount }));
  for (const figure of groupFigures) {
    if (!figure.active || figure.kind !== kind) continue;
    if (!Number.isInteger(figure.year)) continue;
    if (typeof figure.amount !== "number" || !Number.isFinite(figure.amount)) {
      continue;
    }
    years.add(figure.year);
    const byYear = groupLevel.get(figure.group) ?? new Map<number, number>();
    byYear.set(figure.year, figure.amount);
    groupLevel.set(figure.group, byYear);
  }

  const groupNames = new Set([...accountTotals.keys(), ...groupLevel.keys()]);
  const sortedYears = [...years].sort((a, b) => a - b);
  const groups = [...groupNames]
    .sort((a, b) => a.localeCompare(b))
    .map((group): ActualGroup => {
      const actualByYear = new Map<number, number>();
      for (const year of sortedYears) {
        const override = groupLevel.get(group)?.get(year);
        const value = override ?? accountTotals.get(group)?.get(year);
        if (value !== undefined) actualByYear.set(year, value);
      }
      return {
        group,
        isRepair: isRepairGroup(group, reportingAccounts.get(group) ?? []),
        actualByYear,
      };
    });

  return { years: sortedYears, groups };
}

/**
 * The group name is authoritative; account `nature` is the fallback for a
 * renamed group. Only accounts that report an actual are consulted, so an
 * inactive account left over in the chart cannot reclassify a whole group.
 * A group known only from a group-level actual has no accounts to consult,
 * which leaves its name as the sole test - correctly, since there is nothing
 * else to go on.
 */
function isRepairGroup(
  group: string,
  accounts: readonly CalculationFinancialAccount[],
): boolean {
  if (group.trim().toUpperCase() === REPAIR_GROUP_NAME) return true;
  const natures = accounts
    .map((account) => account.nature)
    .filter((nature): nature is FinancialAccountNature => nature !== undefined);
  return natures.length > 0 && natures.every((nature) => nature === "repair");
}

/** Sum of the groups reporting that year; undefined when none reports. */
function sumPresent(
  groups: readonly ActualGroup[],
  year: number,
): number | undefined {
  const values = groups
    .map((group) => group.actualByYear.get(year))
    .filter((value): value is number => value !== undefined);
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0);
}

/**
 * Cents. Not cosmetic: admin and visitor must agree exactly, and comparing
 * two independently accumulated float sums for equality is how a difference of
 * 1e-11 becomes a failed integrity check.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function unavailable(
  reason: OperatingFiguresUnavailableReason,
): OperatingFiguresUnavailable {
  return { status: "unavailable", reason };
}
