import type { BalanceEntry, BalanceSheetSnapshot } from "../domain/types.js";

/**
 * Which balance-sheet line is the cash: "Rahat ja pankkisaamiset".
 *
 * A DELIBERATE DUPLICATE of isCashEntry in public/adminOperationPayloads.js.
 * The browser's balance ratios (kassa kuukausina hoitokuluja) and the cash
 * path table's cash columns must pick the same line, and the browser cannot
 * import this module. public/adminOperationPayloads.test.js pins the two
 * against each other over a shared set of entries, so a change to one rule
 * without the other fails there rather than showing two different cash
 * figures. Change both, or neither.
 */
export function isBalanceCashEntry(
  entry: Pick<BalanceEntry, "key" | "name">,
): boolean {
  if (entry.key === "rahat") return true;
  return entry.name.toLowerCase().startsWith("rahat ja pankki");
}

/**
 * Closing cash per accounting year, read off the balance sheets.
 *
 * A balance sheet dated 31.12.2025 states 2025's closing cash and therefore
 * 2026's opening cash; the year is the asOfDate's year. Several sheets for
 * one year (a restated closing) resolve to the latest date, ties to the id
 * that sorts last. A sheet without a cash line contributes nothing - the
 * year stays absent, and absent renders as "—", never as zero.
 */
export function cashByClosingYear(
  snapshots: readonly BalanceSheetSnapshot[],
): ReadonlyMap<number, number> {
  const ordered = [...snapshots].sort(
    (a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.id.localeCompare(b.id),
  );
  const result = new Map<number, number>();
  for (const snapshot of ordered) {
    const year = Number(snapshot.asOfDate.slice(0, 4));
    if (!Number.isInteger(year)) continue;
    const cash = snapshot.entries.find(isBalanceCashEntry);
    if (cash === undefined) continue;
    result.set(year, cash.amount);
  }
  return result;
}
