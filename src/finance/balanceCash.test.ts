import { describe, expect, it } from "vitest";
import { cashPathBalanceSheets } from "../fixtures/cashPathTable.js";
import { cashByClosingYear, isBalanceCashEntry } from "./balanceCash.js";

describe("cashByClosingYear", () => {
  it("reads each sheet's cash line into the year it closes", () => {
    const cash = cashByClosingYear(cashPathBalanceSheets);

    expect([...cash.entries()]).toEqual([[2024, 16_977.00], [2025, 22_208.00]]);
  });

  it("leaves a year without a sheet absent, not zero", () => {
    const cash = cashByClosingYear(cashPathBalanceSheets);

    expect(cash.has(2023)).toBe(false);
    expect(cash.get(2023)).toBeUndefined();
  });

  it("leaves a year whose sheet has no cash line absent", () => {
    const [sheet2024] = cashPathBalanceSheets;
    const withoutCash = {
      ...sheet2024!,
      entries: sheet2024!.entries.filter((entry) => !isBalanceCashEntry(entry)),
    };

    expect(cashByClosingYear([withoutCash]).has(2024)).toBe(false);
  });

  it("lets a restated sheet for the same year win by date", () => {
    const [sheet2024] = cashPathBalanceSheets;
    const restated = {
      ...sheet2024!,
      id: "tase_2024_korjattu",
      asOfDate: "2024-12-31",
      entries: [{ section: "current_assets" as const, key: "rahat", name: "Rahat", amount: 17_000 }],
    };
    // Same date: the id that sorts last wins, and it is the restated one.
    expect(cashByClosingYear([restated, sheet2024!]).get(2024)).toBe(17_000);
  });
});
