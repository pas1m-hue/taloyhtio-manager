import { describe, expect, it } from "vitest";
import type { BuildingEvent, HousingCompany } from "../domain/types.js";
import {
  cashPathAssets,
  cashPathBalanceSheets,
  cashPathCostEvidence,
  cashPathEvents,
  cashPathFinancialAccounts,
  cashPathFinancialEntries,
  cashPathGroupActuals,
  cashPathGroupBudgets,
} from "../fixtures/cashPathTable.js";
import { buildCashPathTable, type CashPathTableSource } from "./cashPathTable.js";

const housingCompany: HousingCompany = {
  id: "company",
  name: "As Oy Testi",
  apartmentCount: 12,
  maintenancePlanCoverageThroughYear: 2030,
};

const SOURCE: CashPathTableSource = {
  housingCompany,
  financialAccounts: cashPathFinancialAccounts,
  financialEntries: cashPathFinancialEntries,
  groupActuals: cashPathGroupActuals,
  groupBudgets: cashPathGroupBudgets,
  balanceSheetSnapshots: cashPathBalanceSheets,
  assets: cashPathAssets,
  events: cashPathEvents,
  costEvidence: cashPathCostEvidence,
  priceLevelConfirmations: [],
};

describe("buildCashPathTable", () => {
  const table = buildCashPathTable(SOURCE);
  const base = table.scenarios.base;

  it("has one row per closed year plus one per budgeted year, and none after", () => {
    // 2027 onward has neither actuals nor a budget, so there is no row - not
    // a dashed one, not one carrying the latest year's figure forward.
    expect(base.rows.map((row) => [row.year, row.rowKind])).toEqual([
      [2023, "actual"],
      [2024, "actual"],
      [2025, "actual"],
      [2026, "budget"],
    ]);
    expect(table.latestActualYear).toBe(2025);
    expect(table.maintenancePlanCoverageThroughYear).toBe(2030);
  });

  it("states each closed year's hoitokate from that year's own figures", () => {
    const margins = base.rows
      .filter((row) => row.rowKind === "actual")
      .map((row) => row.operatingMargin);

    expect(margins).toEqual([5_706.38, 10_144.00, 9_877.29]);
    expect(new Set(margins).size).toBe(3);
  });

  it("reads the closed years' cash off the balance sheets", () => {
    const [row2023, row2024, row2025] = base.rows;

    // No 2023 sheet: nothing to open 2024 with, nothing to close 2023 with.
    expect(row2023).toMatchObject({ rowKind: "actual", year: 2023, repairs: 1_385.00 });
    expect(row2023).not.toHaveProperty("openingCash");
    expect(row2023).not.toHaveProperty("closingCash");
    expect(row2024).toMatchObject({ year: 2024, closingCash: 16_977.00 });
    expect(row2024).not.toHaveProperty("openingCash");
    expect(row2025).toMatchObject({ year: 2025, openingCash: 16_977.00, closingCash: 22_208.00 });
  });

  it("never turns a missing balance sheet into a zero", () => {
    for (const row of base.rows) {
      expect(row.openingCash).not.toBe(0);
      expect(row.closingCash).not.toBe(0);
    }
  });

  it("compares each closed year's hoitokate with its own budget", () => {
    const [row2023, , row2025] = base.rows;

    // 2023 budget: 36 000 − (34 000 − 3 000) = 5 000; actual 5 706,38.
    expect(row2023).toMatchObject({ repairBudget: 3_000.00, marginVsBudget: 706.38 });
    // 2025 budget: 42 700 − (42 750 − 9 400) = 9 350; actual 9 877,29.
    expect(row2025).toMatchObject({ repairBudget: 9_400.00, marginVsBudget: 527.29 });
  });

  it("builds the budget row from the budget, with the group budget winning", () => {
    const budgetRow = base.rows.at(-1);

    expect(budgetRow).toEqual({
      rowKind: "budget",
      year: 2026,
      openingCash: 22_208.00,
      operatingMargin: 9_458.55,
      repairs: 4_300.00, // ilmanvaihto 2 500 + one heater 1 800
      repairDataGapCount: 0,
      closingCash: 27_366.55, // 22 208 + 9 458,55 − 4 300
      repairBudget: 9_680.00,
    });
  });

  it("follows the scenario only on the budget row, never on the closed years", () => {
    const actualRows = (scenario: "optimistic" | "base" | "stress") =>
      table.scenarios[scenario].rows.filter((row) => row.rowKind === "actual");

    expect(actualRows("optimistic")).toEqual(actualRows("base"));
    expect(actualRows("stress")).toEqual(actualRows("base"));
    expect(table.scenarios.stress.rows.at(-1)).toMatchObject({
      rowKind: "budget",
      repairs: 6_100.00, // 2 500 + two heaters
      closingCash: 25_566.55,
    });
  });

  it("marks the row's quality in the model, not by which cells are filled", () => {
    // A budget row with every cell filled is still a budget row.
    const budgetRow = base.rows.at(-1)!;
    expect(budgetRow.rowKind).toBe("budget");
    expect(budgetRow.openingCash).toBeDefined();
    expect(budgetRow.closingCash).toBeDefined();
  });

  it("lists every known repair in the banner, past the coverage too", () => {
    // The 2032/2033 heaters are after the plan's coverage (2030). They are
    // not rows in the table, but they are in the list.
    expect(base.rows.some((row) => row.year > 2026)).toBe(false);
    expect(base.knownRepairs.rows.map((row) => [row.year, row.title, row.amount, row.priceQuality])).toEqual([
      [2026, "Ilmanvaihdon puhdistus", 2_500, "estimate"],
      [2026, "Varaajien uusiminen", 1_800, "estimate"],
      [2027, "Julkisivujen huoltomaalaus", 15_000, "quote"],
      [2029, "Varaajien uusiminen", 3_600, "estimate"],
      [2033, "Varaajien uusiminen", 3_600, "estimate"],
    ]);
    expect(base.knownRepairs.total).toBe(26_500);
    expect(base.knownRepairs.dataGapCount).toBe(0);
  });

  it("follows the scenario in the banner", () => {
    expect(table.scenarios.optimistic.knownRepairs.total).toBe(21_100);
    expect(table.scenarios.base.knownRepairs.total).toBe(26_500);
    expect(table.scenarios.stress.knownRepairs.total).toBe(30_100);
  });

  it("names a DATA GAP in the banner instead of pricing it", () => {
    const gap = table.scenarios.stress.knownRepairs.rows.find(
      (row) => row.title === "Piha-alueen salaojat",
    );

    expect(gap).toMatchObject({ year: 2028, priceQuality: "data_gap" });
    expect(gap).not.toHaveProperty("amount");
    expect(table.scenarios.stress.knownRepairs.dataGapCount).toBe(1);
  });

  it("withholds a budget row's closing cash when its repairs carry a DATA GAP", () => {
    const gapIn2026: BuildingEvent = {
      id: "event_gap_2026",
      assetId: "asset_facade",
      title: "Tuntematon",
      type: "repair",
      origin: "manual",
      status: "approved",
      sourceIds: ["x"],
      schedule: [{ id: "g_b", scenario: "base", year: 2026, costEvidenceId: "K_gap_2026" }],
    };
    const withGap = buildCashPathTable({
      ...SOURCE,
      events: [...cashPathEvents, gapIn2026],
      costEvidence: [
        ...cashPathCostEvidence,
        { id: "K_gap_2026", assetId: "asset_facade", eventId: "event_gap_2026", status: "data_gap", unit: "total", priceLevelYear: 2026, sourceId: "x" },
      ],
    });
    const budgetRow = withGap.scenarios.base.rows.at(-1);

    expect(budgetRow).toMatchObject({ rowKind: "budget", repairs: 4_300, repairDataGapCount: 1 });
    expect(budgetRow).not.toHaveProperty("closingCash");
    // The other scenarios do not carry that gap and still close.
    expect(withGap.scenarios.optimistic.rows.at(-1)).toHaveProperty("closingCash");
  });

  it("keeps suggested events out of the banner", () => {
    const titles = base.knownRepairs.rows.map((row) => row.title);
    expect(titles).not.toContain("Sokkelin kosteuseristys");
  });

  it("lists completed repairs with the realised price only", () => {
    expect(table.completedRepairs).toEqual([
      {
        year: 2025,
        eventId: "event_iv_2025_actual",
        assetId: "asset_ventilation",
        title: "IV-putkien eristys",
        occurredAt: "2025-11-14",
        amount: 1_545,
      },
    ]);
  });

  it("has an empty completed list, and does not fall over, without actual events", () => {
    const noHistory = buildCashPathTable({
      ...SOURCE,
      events: cashPathEvents.filter((event) => event.status !== "actual"),
    });

    expect(noHistory.completedRepairs).toEqual([]);
    expect(noHistory.scenarios.base.rows).toEqual(base.rows);
  });

  it("leaves a completed repair's price absent when it was recorded against a DATA GAP", () => {
    const gapHistory = buildCashPathTable({
      ...SOURCE,
      events: cashPathEvents.map((event) =>
        event.status === "actual"
          ? { ...event, actual: { year: 2025, costEvidenceId: "K_actual_gap" } }
          : event
      ),
      costEvidence: [
        ...cashPathCostEvidence,
        { id: "K_actual_gap", assetId: "asset_ventilation", eventId: "event_iv_2025_actual", status: "data_gap", unit: "total", priceLevelYear: 2025, sourceId: "x" },
      ],
    });

    expect(gapHistory.completedRepairs[0]).not.toHaveProperty("amount");
  });

  it("ignores the page horizon: the table is built from the plan as entered", () => {
    // There is no horizon parameter at all - a company with approved rows in
    // 2033 lists them regardless of what any selector elsewhere says.
    expect(buildCashPathTable.length).toBe(1);
    expect(base.knownRepairs.rows.at(-1)?.year).toBe(2033);
  });

  it("shows every year that has data when the coverage is unset", () => {
    const unset = buildCashPathTable({
      ...SOURCE,
      housingCompany: { id: "company", name: "As Oy Testi", apartmentCount: 12 },
    });

    expect(unset.maintenancePlanCoverageThroughYear).toBeUndefined();
    expect(unset.scenarios.base.rows.map((row) => row.year)).toEqual([2023, 2024, 2025, 2026]);
  });

  it("builds an empty table for a company with no account data at all", () => {
    const empty = buildCashPathTable({
      ...SOURCE,
      financialAccounts: [],
      financialEntries: [],
      groupActuals: [],
      groupBudgets: [],
      balanceSheetSnapshots: [],
      events: [],
      costEvidence: [],
    });

    expect(empty.scenarios.base.rows).toEqual([]);
    expect(empty.scenarios.base.knownRepairs).toEqual({ rows: [], total: 0, dataGapCount: 0 });
    expect(empty.completedRepairs).toEqual([]);
    expect(empty.latestActualYear).toBeUndefined();
  });

  it("keeps a budget for a closed year as comparison data, not as a row", () => {
    // 2025 has both an actual and a budget; it must be one actual row.
    expect(base.rows.filter((row) => row.year === 2025)).toHaveLength(1);
    expect(base.rows.find((row) => row.year === 2025)?.rowKind).toBe("actual");
  });
});
