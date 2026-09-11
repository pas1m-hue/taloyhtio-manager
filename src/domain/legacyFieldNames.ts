import type {
  LiquidityBaselineRecord,
  SessionLiquidityOverrides,
} from "./types.js";

/**
 * Stored JSONB written under a field name the code no longer uses
 * (refactor/hoitokate-naming). The single-blob snapshot has no migration
 * path, so the rename is absorbed here, on read, once per load: the old
 * key is moved to the new one and dropped, and the value is unchanged.
 *
 * The rename: `currentAnnualRepairCollection` was hoitokate all along -
 * income minus operating costs without repairs - never a repair
 * collection. The UI has said "Hoitokate" since PR #23; the code now does.
 *
 * A row that already carries the new key is left alone, so a re-saved
 * snapshot is not touched twice. A row with neither key is left alone too:
 * validation, not this function, is where a missing figure is reported.
 *
 * THE FINGERPRINT HASHES THE LEGACY NAME. Every publication ever written
 * carries a contentFingerprint computed over the old key, and
 * validatePublishedDataSnapshot recomputes the hash on every load. Hashing
 * the renamed content would fail that check for every existing publication
 * (INVALID_PUBLISHED_DATA - found in the live check, not the unit tests,
 * whose fixture had been published after the rename). So the hash is taken
 * over the content with the key mapped back (withLegacyBaselineKey): the
 * name in the hash is a storage detail, and identical content keeps an
 * identical fingerprint across the rename.
 */
const LEGACY_BASELINE_KEY = "currentAnnualRepairCollection";
const LEGACY_OVERRIDE_KEY = "annualRepairCollectionByScenario";

export function withRenamedBaselineField(
  record: LiquidityBaselineRecord,
): LiquidityBaselineRecord {
  const raw = record as LiquidityBaselineRecord & { [LEGACY_BASELINE_KEY]?: number };
  if (raw[LEGACY_BASELINE_KEY] === undefined ||
      raw.currentAnnualOperatingMargin !== undefined) {
    return record;
  }
  const { [LEGACY_BASELINE_KEY]: legacy, ...rest } = raw;
  return { ...rest, currentAnnualOperatingMargin: legacy };
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

/** The inverse, for hashing: the stored name, whichever the record carries. */
export function withLegacyBaselineKey(
  record: LiquidityBaselineRecord,
): Record<string, unknown> {
  const { currentAnnualOperatingMargin, ...rest } = record;
  return currentAnnualOperatingMargin === undefined
    ? { ...rest }
    : { ...rest, [LEGACY_BASELINE_KEY]: currentAnnualOperatingMargin };
}
