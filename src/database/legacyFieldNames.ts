import type {
  LiquidityBaselineRecord,
  SessionLiquidityOverrides,
} from "../domain/types.js";

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
