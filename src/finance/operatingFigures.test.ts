import { describe, expect, it } from "vitest";
import {
  computeOperatingCostFigures,
  computeOperatingMarginFigures,
  computeOperatingMarginSeries,
  type CalculationFinancialAccount,
  type FinancialActualsSource,
} from "./operatingFigures.js";
import {
  cashPathFinancialAccounts,
  cashPathFinancialEntries,
  cashPathGroupActuals,
  cashPathGroupBudgets,
} from "../fixtures/cashPathTable.js";

/**
 * Figures reproduced from the real company data (handoff
 * lasketut-likviditeettisyotteet §1 and §4, confirmed against production):
 *
 *   income 2025    43 906,75 = 43 150,75 + 756,00 + 0,00
 *   expenses 2025  37 911,01, of which KORJAUKSET 3 881,55
 *   ex repairs     34 029,46
 *   hoitokate      9 877,29
 *   income 2023    37 207,38, where Hoitovastikkeet is 36 237,38 at the group
 *                  level against 3 527,50 from the imported accounts
 *
 * Repairs report 2024 and 2025 (5 348,53 and 3 881,55), which is the sample
 * documented in handoff feature/trailing-12m §1 - so the divisor this fixture
 * produces, 38 644,50, is that handoff's own worked number and not one
 * reverse-engineered from the current KPI.
 */
const ACCOUNTS = [
  { accountCode: "3010", name: "Hoitovastikkeet", kind: "income", group: "Hoitovastikkeet", active: true },
  { accountCode: "3110", name: "Vuokrat", kind: "income", group: "Vuokrat", active: true },
  { accountCode: "3200", name: "Muut tuotot", kind: "income", group: "Muut tuotot", active: true },
  { accountCode: "4010", name: "Hallinto", kind: "expense", group: "Hallinto", nature: "maintenance", active: true },
  { accountCode: "4200", name: "Lämmitys", kind: "expense", group: "Lämmitys", nature: "maintenance", active: true },
  { accountCode: "4600", name: "Korjaukset", kind: "expense", group: "KORJAUKSET", nature: "repair", active: true },
] as const;

const ENTRIES = [
  // 2023: the accounts carry only part of the income; the rest arrives as a
  // group-level actual below.
  { accountCode: "3010", year: 2023, actualAmount: 3_527.50, sourceIds: ["tp2023"] },
  { accountCode: "3110", year: 2023, actualAmount: 720.00, sourceIds: ["tp2023"] },
  { accountCode: "3200", year: 2023, actualAmount: 250.00, sourceIds: ["tp2023"] },
  { accountCode: "4010", year: 2024, actualAmount: -12_000.00, sourceIds: ["tp2024"] },
  { accountCode: "4200", year: 2024, actualAmount: -20_500.00, sourceIds: ["tp2024"] },
  { accountCode: "4600", year: 2024, actualAmount: -5_348.53, sourceIds: ["tp2024"] },
  // 2025: 43 906,75 income, 37 911,01 expenses of which 3 881,55 repairs.
  { accountCode: "3010", year: 2025, actualAmount: 43_150.75, sourceIds: ["tp2025"] },
  { accountCode: "3110", year: 2025, actualAmount: 756.00, sourceIds: ["tp2025"] },
  { accountCode: "3200", year: 2025, actualAmount: 0.00, sourceIds: ["tp2025"] },
  { accountCode: "4010", year: 2025, actualAmount: -13_100.20, sourceIds: ["tp2025"] },
  { accountCode: "4200", year: 2025, actualAmount: -20_929.26, sourceIds: ["tp2025"] },
  { accountCode: "4600", year: 2025, actualAmount: -3_881.55, sourceIds: ["tp2025"] },
] as const;

const GROUP_ACTUALS = [
  {
    id: "ga_income_hoitovastikkeet_2023",
    group: "Hoitovastikkeet",
    kind: "income",
    year: 2023,
    actualAmount: 36_237.38,
    active: true,
    sourceIds: ["tp2023"],
  },
] as const;

const SOURCE: FinancialActualsSource = {
  financialAccounts: ACCOUNTS,
  financialEntries: ENTRIES,
  groupActuals: GROUP_ACTUALS,
};

function available<T extends { status: string }>(result: T) {
  if (result.status !== "available") {
    throw new Error(`expected available, got ${JSON.stringify(result)}`);
  }
  return result as Extract<T, { status: "available" }>;
}

describe("computeOperatingCostFigures", () => {
  it("states the latest year's costs without repairs", () => {
    const result = available(computeOperatingCostFigures(SOURCE));

    expect(result.latestActualYear).toBe(2025);
    expect(result.costsExcludingRepairs).toBe(34_029.46);
  });

  it("normalises repairs over every year that reports them", () => {
    const result = available(computeOperatingCostFigures(SOURCE));

    expect(result.repairYears).toEqual([2024, 2025]);
    expect(result.repairAverage).toBe(4_615.04);
    expect(result.trailing12mOperatingCosts).toBe(38_644.50);
  });

  it("has no repair group to find, and says so instead of using zero", () => {
    // A silent zero would shrink the divisor and make months-of-cash look
    // better than it is - wrong in the direction that matters.
    const result = computeOperatingCostFigures({
      ...SOURCE,
      financialAccounts: renamedWithoutNature(ACCOUNTS),
    });

    expect(result).toEqual({ status: "unavailable", reason: "repair_group_missing" });
  });

  it("finds a renamed repair group through its accounts' nature", () => {
    const renamed = ACCOUNTS.map((account) =>
      account.group === "KORJAUKSET" ? { ...account, group: "Kunnossapito" } : account
    );
    const result = available(
      computeOperatingCostFigures({ ...SOURCE, financialAccounts: renamed }),
    );

    expect(result.costsExcludingRepairs).toBe(34_029.46);
  });

  it("reports no expense actuals rather than dividing by nothing", () => {
    expect(computeOperatingCostFigures({ ...SOURCE, financialEntries: [] }))
      .toEqual({ status: "unavailable", reason: "no_expense_actuals" });
  });

  it("refuses the latest year when repairs are missing for exactly that year", () => {
    const withoutLatestRepair = ENTRIES.filter(
      (entry) => !(entry.accountCode === "4600" && entry.year === 2025),
    );
    const result = computeOperatingCostFigures({
      ...SOURCE,
      financialEntries: withoutLatestRepair,
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "repair_actual_missing_for_latest_year",
    });
  });
});

describe("computeOperatingMarginFigures", () => {
  it("computes the hoitokate the cash path collects each year", () => {
    const result = available(computeOperatingMarginFigures(SOURCE));

    expect(result.latestActualYear).toBe(2025);
    expect(result.income).toBe(43_906.75);
    expect(result.costsExcludingRepairs).toBe(34_029.46);
    expect(result.operatingMargin).toBe(9_877.29);
  });

  it("returns its parts, so a view can show the subtraction it made", () => {
    const result = available(computeOperatingMarginFigures(SOURCE));

    expect(result.income - result.costsExcludingRepairs)
      .toBeCloseTo(result.operatingMargin, 10);
  });

  it("subtracts the same costs the divisor is built from", () => {
    // The two figures are stated in the same year's terms and share the
    // ex-repairs component. If someone recomputes either one separately, this
    // is the test that notices.
    const costs = available(computeOperatingCostFigures(SOURCE));
    const margin = available(computeOperatingMarginFigures(SOURCE));

    expect(margin.costsExcludingRepairs).toBe(costs.costsExcludingRepairs);
    expect(margin.latestActualYear).toBe(costs.latestActualYear);
  });

  it("lets a group-level actual win over the accounts, on the income side", () => {
    // 2023 is the case from PR #19: the accounts hold 3 527,50 of
    // Hoitovastikkeet, the group-level figure says 36 237,38, and the year's
    // real income is 37 207,38. Without the override this is 4 497,50.
    const income2023 = incomeFor(2023, SOURCE);

    expect(income2023).toBe(37_207.38);
  });

  it("lets a group-level actual win over the accounts, on the expense side too", () => {
    // The asymmetry this closes: income has honoured group-level actuals since
    // PR #19 and expenses did not, so a hoitokate built from both would have
    // subtracted one definition of "actual" from another.
    const withExpenseOverride = [
      ...GROUP_ACTUALS,
      {
        id: "ga_expense_lammitys_2025",
        group: "Lämmitys",
        kind: "expense",
        year: 2025,
        actualAmount: -22_000.00,
        active: true,
        sourceIds: ["tp2025"],
      } as const,
    ];
    const result = available(computeOperatingMarginFigures({
      ...SOURCE,
      groupActuals: withExpenseOverride,
    }));

    // Lämmitys moves -20 929,26 -> -22 000,00, so costs ex repairs rise by
    // 1 070,74 and the margin falls by the same amount.
    expect(result.costsExcludingRepairs).toBe(35_100.20);
    expect(result.operatingMargin).toBe(8_806.55);
  });

  it("ignores a group-level actual that is not active", () => {
    const inactive = GROUP_ACTUALS.map((actual) => ({ ...actual, active: false }));
    const result = incomeFor(2023, { ...SOURCE, groupActuals: inactive });

    expect(result).toBe(4_497.50);
  });

  it("treats a missing income year as a gap, not as zero income", () => {
    // Zero income against real costs would invent a deficit of the entire
    // year's operating cost and present it as a measurement.
    const expensesOnly = ENTRIES.filter((entry) => entry.accountCode.startsWith("4"));
    const result = computeOperatingMarginFigures({
      ...SOURCE,
      financialEntries: expensesOnly,
      groupActuals: [],
    });

    expect(result).toEqual({ status: "unavailable", reason: "no_income_actuals" });
  });

  it("names the income year specifically when other income years exist", () => {
    const withoutLatestIncome = ENTRIES.filter(
      (entry) => !(entry.accountCode.startsWith("3") && entry.year === 2025),
    );
    const result = computeOperatingMarginFigures({
      ...SOURCE,
      financialEntries: withoutLatestIncome,
    });

    expect(result).toEqual({
      status: "unavailable",
      reason: "income_missing_for_latest_year",
    });
  });

  it("carries an expense-side gap through rather than reporting it as income", () => {
    expect(computeOperatingMarginFigures({ ...SOURCE, financialEntries: [] }))
      .toEqual({ status: "unavailable", reason: "no_expense_actuals" });
  });

  it("keeps a negative margin expressible", () => {
    // The situation the whole application exists for. A name or a Math.abs
    // that cannot represent this would hide exactly the case that matters.
    const poorer = ENTRIES.map((entry) =>
      entry.accountCode === "3010" && entry.year === 2025
        ? { ...entry, actualAmount: 20_000.00 }
        : entry
    );
    const result = available(
      computeOperatingMarginFigures({ ...SOURCE, financialEntries: poorer }),
    );

    expect(result.operatingMargin).toBe(-13_273.46);
  });
});

/**
 * The income total the margin calculation reads for one year, isolated for
 * assertions. The margin is always stated in the terms of the latest year with
 * expense actuals, so the probe supplies a repair-only expense for the year
 * under test: that makes it the latest expense year without contributing
 * anything to the income being measured.
 */
function incomeFor(year: number, source: FinancialActualsSource): number {
  const scoped: FinancialActualsSource = {
    ...source,
    financialEntries: [
      ...source.financialEntries.filter(
        (entry) => entry.year === year && entry.accountCode.startsWith("3"),
      ),
      { accountCode: "4600", year, actualAmount: -1_000 },
    ],
    groupActuals: source.groupActuals.filter((actual) => actual.year === year),
  };
  return available(computeOperatingMarginFigures(scoped)).income;
}

/**
 * The repair group renamed and its accounts' `nature` removed - the state a
 * chart of accounts lands in when someone renames the group and the import
 * carries no nature column. The key is deleted rather than set to undefined:
 * under exactOptionalPropertyTypes those are different things, and only the
 * deletion is what real data looks like.
 */
function renamedWithoutNature(
  accounts: readonly CalculationFinancialAccount[],
): readonly CalculationFinancialAccount[] {
  return accounts.map((account) => {
    if (account.group !== "KORJAUKSET") return account;
    const { nature: _nature, ...rest } = account;
    return { ...rest, group: "Kunnossapito" };
  });
}

describe("computeOperatingMarginSeries", () => {
  const source = {
    financialAccounts: cashPathFinancialAccounts,
    financialEntries: cashPathFinancialEntries,
    groupActuals: cashPathGroupActuals,
    groupBudgets: cashPathGroupBudgets,
  };

  it("states each closed year from that year's own parts", () => {
    // The old table repeated the latest year's hoitokate down every row. Three
    // different years with three different results from three different sums
    // is what proves the series reads each year for itself.
    const series = computeOperatingMarginSeries(source, "actual");

    expect(series.map((row) => row.year)).toEqual([2023, 2024, 2025]);
    expect(series[0]).toEqual({
      year: 2023,
      income: 37_207.38, // 36 237,38 group-level + 720,00 + 250,00
      costsExcludingRepairs: 31_501.00, // 11 480,00 + 20 021,00
      repairs: 1_385.00,
      operatingMargin: 5_706.38,
    });
    expect(series[1]).toEqual({
      year: 2024,
      income: 42_644.00,
      costsExcludingRepairs: 32_500.00,
      repairs: 5_348.53,
      operatingMargin: 10_144.00,
    });
    expect(series[2]).toEqual({
      year: 2025,
      income: 43_906.75,
      costsExcludingRepairs: 34_029.46,
      repairs: 3_881.55,
      operatingMargin: 9_877.29,
    });
  });

  it("agrees with the latest-year figure the forecast uses", () => {
    const series = computeOperatingMarginSeries(source, "actual");
    const latest = available(computeOperatingMarginFigures(source));

    expect(series.at(-1)?.operatingMargin).toBe(latest.operatingMargin);
    expect(series.at(-1)?.year).toBe(latest.latestActualYear);
  });

  it("builds the budget side with the group budget winning over the account", () => {
    // 4600's own budget row says 9 000,00; the approved group budget says
    // 9 680,00. 42 714,26 - (42 935,71 - 9 680,00) = 9 458,55 - the handoff's
    // worked figure - is only reached if the group budget wins.
    const series = computeOperatingMarginSeries(source, "budget");
    const budget2026 = series.find((row) => row.year === 2026);

    expect(budget2026).toEqual({
      year: 2026,
      income: 42_714.26,
      costsExcludingRepairs: 33_255.71,
      repairs: 9_680.00,
      operatingMargin: 9_458.55,
    });
  });

  it("states a budget year for every year that has one, not just the latest", () => {
    const series = computeOperatingMarginSeries(source, "budget");

    expect(series.map((row) => row.year)).toEqual([2023, 2024, 2025, 2026]);
    expect(series.find((row) => row.year === 2025)?.operatingMargin).toBe(9_350.00);
  });

  it("omits a year whose repair figure is missing rather than calling it zero", () => {
    const withoutRepairs2024 = {
      ...source,
      financialEntries: cashPathFinancialEntries.filter(
        (entry) => !(entry.accountCode === "4600" && entry.year === 2024),
      ),
    };
    const series = computeOperatingMarginSeries(withoutRepairs2024, "actual");

    expect(series.map((row) => row.year)).toEqual([2023, 2025]);
  });

  it("omits a year whose income is missing rather than showing a deficit", () => {
    const withoutIncome2023 = {
      ...source,
      groupActuals: [],
      financialEntries: cashPathFinancialEntries.filter(
        (entry) => !(entry.year === 2023 && entry.accountCode.startsWith("3")),
      ),
    };
    const series = computeOperatingMarginSeries(withoutIncome2023, "actual");

    expect(series.map((row) => row.year)).toEqual([2024, 2025]);
  });

  it("has an empty budget side when the source carries no budget figures", () => {
    const publicationShaped = {
      financialAccounts: cashPathFinancialAccounts,
      financialEntries: cashPathFinancialEntries.map(({ budgetAmount: _b, ...rest }) => rest),
      groupActuals: cashPathGroupActuals,
    };

    expect(computeOperatingMarginSeries(publicationShaped, "budget")).toEqual([]);
  });
});
