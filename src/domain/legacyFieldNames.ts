import type { LiquidityBaselineRecord } from "./types.js";

/**
 * Stored JSONB written under a shape the code no longer uses. The
 * single-blob snapshot has no migration path, so the difference is absorbed
 * here, on read, once per load.
 *
 * Two generations of liquidity baseline rows exist in storage:
 *
 * - pre refactor/hoitokate-naming: `trailing12mOperatingCosts` and
 *   `currentAnnualRepairCollection`;
 * - refactor/hoitokate-naming up to refactor/remove-manual-liquidity-inputs:
 *   `trailing12mOperatingCosts` and `currentAnnualOperatingMargin`.
 *
 * Both figures have been computed from the account data since PR #23 and
 * never read from the record, so all three keys are simply dropped: the
 * record keeps its cash, date, sources and notes. A row without them is
 * left alone, so a re-saved snapshot is not touched twice.
 *
 * This is hygiene, not what keeps an old snapshot loadable: the admin
 * validation does not reject unknown keys, so without it the stale figures
 * would simply ride along in memory and be written back on the next save.
 * What keeps an old row loadable is withDefaultedAdminCollections in the
 * Postgres admin repository (the "is not iterable" failure).
 */
const LEGACY_BASELINE_KEYS = [
  "trailing12mOperatingCosts",
  "currentAnnualOperatingMargin",
  "currentAnnualRepairCollection",
] as const;

export function withoutLegacyBaselineFields(
  record: LiquidityBaselineRecord,
): LiquidityBaselineRecord {
  const raw = record as LiquidityBaselineRecord & Record<string, unknown>;
  if (LEGACY_BASELINE_KEYS.every((key) => raw[key] === undefined)) {
    return record;
  }
  const rest: Record<string, unknown> = { ...raw };
  for (const key of LEGACY_BASELINE_KEYS) delete rest[key];
  return rest as unknown as LiquidityBaselineRecord;
}
