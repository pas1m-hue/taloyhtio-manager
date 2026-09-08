import { describe, expect, it } from "vitest";
// @ts-expect-error - browser module, JSDoc-typed, no declaration file
import { computeTrailing12mOperatingCosts } from "../../public/adminOperationPayloads.js";
import {
  computeOperatingCostFigures,
  type FinancialActualsSource,
} from "./operatingFigures.js";

/**
 * The port is only correct if it reproduces what the application already
 * ships. computeTrailing12mOperatingCosts has been computing the admin
 * "Kassa kuukausina hoitokuluja" divisor in the browser since
 * feature/trailing-12m; operatingFigures.ts now computes the same quantity in
 * the worker so admin and visitor can share one implementation.
 *
 * Until the browser copy is deleted, this file is what keeps them honest: it
 * feeds one fixture to both and fails if they diverge by a cent. That is the
 * §4 requirement - a test that notices if the two calculations drift apart -
 * discharged against the real previous implementation rather than against a
 * second copy of the new one.
 *
 * The fixture deliberately carries no expense-side group-level actuals. The
 * browser copy never honoured those and the new one does, so including one
 * here would be comparing two things that are meant to differ; that difference
 * has its own test in operatingFigures.test.ts.
 */
const ACCOUNTS = [
  { accountCode: "4010", name: "Hallinto", kind: "expense", group: "Hallinto", nature: "maintenance", active: true },
  { accountCode: "4200", name: "Lämmitys", kind: "expense", group: "Lämmitys", nature: "maintenance", active: true },
  { accountCode: "4300", name: "Vesi ja jätevesi", kind: "expense", group: "Vesi", nature: "maintenance", active: true },
  { accountCode: "4600", name: "Korjaukset", kind: "expense", group: "KORJAUKSET", nature: "repair", active: true },
  { accountCode: "3010", name: "Hoitovastikkeet", kind: "income", group: "Hoitovastikkeet", active: true },
] as const;

const ENTRIES = [
  { accountCode: "4010", year: 2023, actualAmount: -11_402.18, sourceIds: ["tp2023"] },
  { accountCode: "4200", year: 2023, actualAmount: -19_004.55, sourceIds: ["tp2023"] },
  { accountCode: "4300", year: 2023, actualAmount: -2_990.10, sourceIds: ["tp2023"] },
  { accountCode: "4600", year: 2023, actualAmount: -1_385.06, sourceIds: ["tp2023"] },
  { accountCode: "4010", year: 2024, actualAmount: -12_000.00, sourceIds: ["tp2024"] },
  { accountCode: "4200", year: 2024, actualAmount: -20_500.00, sourceIds: ["tp2024"] },
  { accountCode: "4300", year: 2024, actualAmount: -3_100.44, sourceIds: ["tp2024"] },
  { accountCode: "4600", year: 2024, actualAmount: -5_348.53, sourceIds: ["tp2024"] },
  { accountCode: "4010", year: 2025, actualAmount: -13_100.20, sourceIds: ["tp2025"] },
  { accountCode: "4200", year: 2025, actualAmount: -17_829.26, sourceIds: ["tp2025"] },
  { accountCode: "4300", year: 2025, actualAmount: -3_100.00, sourceIds: ["tp2025"] },
  { accountCode: "4600", year: 2025, actualAmount: -3_881.55, sourceIds: ["tp2025"] },
  { accountCode: "3010", year: 2025, actualAmount: 43_150.75, sourceIds: ["tp2025"] },
] as const;

const SOURCE: FinancialActualsSource = {
  financialAccounts: ACCOUNTS,
  financialEntries: ENTRIES,
  groupActuals: [],
};

describe("operatingFigures matches the browser implementation it replaces", () => {
  it("agrees on the divisor and on every part it is built from", () => {
    const browser = computeTrailing12mOperatingCosts(ACCOUNTS, ENTRIES);
    const worker = computeOperatingCostFigures(SOURCE);

    expect(browser.status).toBe("available");
    if (worker.status !== "available") throw new Error("worker figures unavailable");

    expect(worker.latestActualYear).toBe(browser.latestActualYear);
    expect(worker.repairYears).toEqual(browser.repairYears);
    expect(worker.costsExcludingRepairs)
      .toBeCloseTo(browser.latestYearCostsExRepairs, 2);
    expect(worker.repairAverage).toBeCloseTo(browser.repairAverage, 2);
    expect(worker.trailing12mOperatingCosts).toBeCloseTo(browser.value, 2);
  });

  it("agrees that a missing repair group makes the divisor unavailable", () => {
    const renamed = ACCOUNTS.map((account) => {
      if (account.group !== "KORJAUKSET") return account;
      const { nature: _nature, ...rest } = account;
      return { ...rest, group: "Kunnossapito" };
    });
    const browser = computeTrailing12mOperatingCosts(renamed, ENTRIES);
    const worker = computeOperatingCostFigures({ ...SOURCE, financialAccounts: renamed });

    expect(worker.status).toBe("unavailable");
    expect(browser.status).toBe("unavailable");
    if (worker.status !== "unavailable") throw new Error("unreachable");
    expect(worker.reason).toBe(browser.reason);
  });

  it("agrees that no expense actuals makes the divisor unavailable", () => {
    const browser = computeTrailing12mOperatingCosts(ACCOUNTS, []);
    const worker = computeOperatingCostFigures({ ...SOURCE, financialEntries: [] });

    if (worker.status !== "unavailable") throw new Error("unreachable");
    expect(worker.reason).toBe(browser.reason);
  });

  it("agrees when the latest year has no repair actual of its own", () => {
    const withoutLatestRepair = ENTRIES.filter(
      (entry) => !(entry.accountCode === "4600" && entry.year === 2025),
    );
    const browser = computeTrailing12mOperatingCosts(ACCOUNTS, withoutLatestRepair);
    const worker = computeOperatingCostFigures({
      ...SOURCE,
      financialEntries: withoutLatestRepair,
    });

    if (worker.status !== "unavailable") throw new Error("unreachable");
    expect(worker.reason).toBe(browser.reason);
    expect(worker.reason).toBe("repair_actual_missing_for_latest_year");
  });
});
