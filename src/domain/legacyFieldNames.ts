import type {
  LiquidityBaselineRecord,
  SessionLiquidityOverrides,
} from "./types.js";

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
 * THE STORED FINGERPRINT WAS HASHED OVER THE OLD SHAPE. Every publication
 * carries a contentFingerprint, and the current code recomputes the hash
 * over the current shape on every load (validatePublishedDataSnapshot).
 * The values needed to reproduce an old hash are gone once the fields are
 * dropped, so the reconciliation happens where the raw row is still at
 * hand: postgresPublishingRepository verifies the stored fingerprint
 * against the raw payload (fingerprintStoredPublicationPayload), then
 * normalises the loaded snapshot's fingerprint to the current shape, the
 * same way the field names are normalised. See that repository.
 */
const LEGACY_BASELINE_KEYS = [
  "trailing12mOperatingCosts",
  "currentAnnualOperatingMargin",
  "currentAnnualRepairCollection",
] as const;
const LEGACY_OVERRIDE_KEY = "annualRepairCollectionByScenario";

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

export function withRenamedOverrideField(
  overrides: SessionLiquidityOverrides,
): SessionLiquidityOverrides {
  const raw = overrides as SessionLiquidityOverrides & {
    [LEGACY_OVERRIDE_KEY]?: SessionLiquidityOverrides["annualOperatingMarginByScenario"];
  };
  if (raw[LEGACY_OVERRIDE_KEY] === undefined ||
      raw.annualOperatingMarginByScenario !== undefined) {
    return overrides;
  }
  const { [LEGACY_OVERRIDE_KEY]: legacy, ...rest } = raw;
  return { ...rest, annualOperatingMarginByScenario: legacy };
}

/**
 * The shape a stored fingerprint was computed over, for verifying a raw
 * publication row. Three generations of rows exist and one rule covers all
 * of them: the hoitokate figure is hashed under its original key.
 *
 * - pre refactor/hoitokate-naming: the row carries
 *   `currentAnnualRepairCollection` and was hashed with it - unchanged;
 * - refactor/hoitokate-naming rows: the row carries
 *   `currentAnnualOperatingMargin` but was hashed with the key mapped back
 *   to `currentAnnualRepairCollection` (that code hashed the legacy name on
 *   purpose so existing publications stayed valid) - mapped back here;
 * - refactor/remove-manual-liquidity-inputs rows: neither key - unchanged.
 *
 * `trailing12mOperatingCosts` stays as stored in every generation.
 */
export function withStoredBaselineHashKeys(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const { currentAnnualOperatingMargin, ...rest } = record;
  return currentAnnualOperatingMargin === undefined
    ? { ...rest }
    : { ...rest, currentAnnualRepairCollection: currentAnnualOperatingMargin };
}
