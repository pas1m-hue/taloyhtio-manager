import type {
  FinancialAccount,
  FinancialEntry,
  GroupActual,
} from "../domain/types.js";

/**
 * Account data for the corrected workbook, as far as the operating figures
 * need it. Confirmed against the company's own accounts:
 *
 *   income 2025    43 906,75 = 43 150,75 + 756,00 + 0,00
 *   expenses 2025  37 911,01, of which KORJAUKSET 3 881,55
 *   ex repairs     34 029,46
 *   hoitokate      9 877,29
 *   income 2023    37 207,38, where Hoitovastikkeet reports 36 237,38 at the
 *                  group level against 3 527,50 from the accounts imported
 *
 * Repairs report 2024 and 2025, so the divisor these produce is
 * 34 029,46 + 4 615,04 = 38 644,50 - the sample and the figure worked through
 * in the feature/trailing-12m handoff.
 *
 * This exists as a fixture rather than as seed data: the real figures live in
 * the database, imported from the closing accounts each year. It is here so
 * tests that need a company whose liquidity is computable all describe the
 * same company, and so the numbers a reader checks against are stated once.
 */
export const financialActualsFixture: {
  readonly financialAccounts: readonly FinancialAccount[];
  readonly financialEntries: readonly FinancialEntry[];
  readonly groupActuals: readonly GroupActual[];
} = {
  financialAccounts: [
    { accountCode: "3010", name: "Hoitovastikkeet", kind: "income", group: "Hoitovastikkeet", active: true },
    { accountCode: "3110", name: "Vuokratuotot", kind: "income", group: "Vuokrat", active: true },
    { accountCode: "3200", name: "Muut tuotot", kind: "income", group: "Muut tuotot", active: true },
    { accountCode: "4010", name: "Hallinto", kind: "expense", group: "Hallinto", nature: "maintenance", active: true },
    { accountCode: "4200", name: "Lämmitys", kind: "expense", group: "Lämmitys", nature: "maintenance", active: true },
    { accountCode: "4600", name: "Korjaukset", kind: "expense", group: "KORJAUKSET", nature: "repair", active: true },
  ],
  financialEntries: [
    { accountCode: "3010", year: 2023, actualAmount: 3_527.50, sourceIds: ["tilinpaatos_2023"] },
    { accountCode: "3110", year: 2023, actualAmount: 720.00, sourceIds: ["tilinpaatos_2023"] },
    { accountCode: "3200", year: 2023, actualAmount: 250.00, sourceIds: ["tilinpaatos_2023"] },
    { accountCode: "4010", year: 2024, actualAmount: -12_000.00, sourceIds: ["tilinpaatos_2024"] },
    { accountCode: "4200", year: 2024, actualAmount: -20_500.00, sourceIds: ["tilinpaatos_2024"] },
    { accountCode: "4600", year: 2024, actualAmount: -5_348.53, sourceIds: ["tilinpaatos_2024"] },
    { accountCode: "3010", year: 2025, actualAmount: 43_150.75, sourceIds: ["tilinpaatos_2025"] },
    { accountCode: "3110", year: 2025, actualAmount: 756.00, sourceIds: ["tilinpaatos_2025"] },
    { accountCode: "3200", year: 2025, actualAmount: 0.00, sourceIds: ["tilinpaatos_2025"] },
    { accountCode: "4010", year: 2025, actualAmount: -13_100.20, sourceIds: ["tilinpaatos_2025"] },
    { accountCode: "4200", year: 2025, actualAmount: -20_929.26, sourceIds: ["tilinpaatos_2025"] },
    { accountCode: "4600", year: 2025, actualAmount: -3_881.55, sourceIds: ["tilinpaatos_2025"] },
  ],
  groupActuals: [
    {
      id: "ga_income_hoitovastikkeet_2023",
      group: "Hoitovastikkeet",
      kind: "income",
      year: 2023,
      actualAmount: 36_237.38,
      active: true,
      sourceIds: ["tilinpaatos_2023"],
    },
  ],
};

/** The two figures the fixture above is built to produce. */
export const financialActualsExpected = {
  latestActualYear: 2025,
  costsExcludingRepairs: 34_029.46,
  repairAverage: 4_615.04,
  trailing12mOperatingCosts: 38_644.50,
  income: 43_906.75,
  operatingMargin: 9_877.29,
} as const;
