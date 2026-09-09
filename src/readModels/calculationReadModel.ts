import type {
  AdminDataSnapshot,
  Horizon,
  LiquidityBaselineRecord,
  LiquidityForecastResult,
  ProjectionResult,
  PublishedDataSnapshot,
} from "../domain/types.js";
import { buildLiquidityForecast } from "../liquidity/buildLiquidityForecast.js";
import { buildProjection } from "../projection/buildProjection.js";
import {
  computeOperatingCostFigures,
  computeOperatingMarginFigures,
  type OperatingCostFigures,
  type OperatingFiguresUnavailable,
  type OperatingMarginFigures,
} from "../finance/operatingFigures.js";

/**
 * What the liquidity model could not obtain. `liquidityBaseline` still means
 * the stored record is missing entirely - it supplies the cash balance, which
 * is not derivable from account data. The other two are named separately
 * because they are now computed, and a reader has to be told which number is
 * missing rather than being handed a forecast built on a zero.
 */
export type SnapshotLiquidityMissingField =
  | "liquidityBaseline"
  | "trailing12mOperatingCosts"
  | "operatingMargin";

export type SnapshotLiquidityReadModel =
  | {
      readonly status: "available";
      readonly baselineId: string;
      readonly baselineAsOfDate: string;
      readonly forecast: LiquidityForecastResult;
    }
  | {
      readonly status: "unavailable";
      readonly missingFields: readonly SnapshotLiquidityMissingField[];
    };

/**
 * The derived operating figures, carried whether or not the forecast could be
 * built. Views need them for two jobs the forecast does not do: the admin
 * "Kassa kuukausina hoitokuluja" card divides by the cost figure, and both
 * sides must be able to say which year the numbers are stated in and why one
 * is unavailable. Shipping the parts, not just the totals, is what lets a view
 * show the subtraction it made instead of asserting a result.
 */
export interface SnapshotOperatingFiguresReadModel {
  readonly costs: OperatingCostFigures | OperatingFiguresUnavailable;
  readonly margin: OperatingMarginFigures | OperatingFiguresUnavailable;
}

export interface SnapshotCalculationReadModel {
  readonly horizon: Horizon;
  readonly projection: ProjectionResult;
  readonly operatingFigures: SnapshotOperatingFiguresReadModel;
  readonly liquidity: SnapshotLiquidityReadModel;
}

type CalculationSnapshot = Pick<
  AdminDataSnapshot | PublishedDataSnapshot,
  | "housingCompany"
  | "liquidityBaselines"
  | "assets"
  | "events"
  | "costEvidence"
  | "priceLevelConfirmations"
  | "financialAccounts"
  | "financialEntries"
  | "groupActuals"
>;

/** Shared deterministic calculation composition for admin and publications. */
export function buildSnapshotCalculations(
  snapshot: CalculationSnapshot,
  horizon: Horizon,
): SnapshotCalculationReadModel {
  const projection = buildProjection({
    assets: snapshot.assets,
    events: snapshot.events,
    costEvidence: snapshot.costEvidence,
    priceLevelConfirmations: snapshot.priceLevelConfirmations,
    horizon,
  });
  // Both figures come from account data, never from the baseline record's
  // stored scalars. Those aged unnoticed - a repair budget sitting in an
  // income field and a divisor that had not been updated in two accounting
  // years - which is the whole reason this path exists. A fallback to them
  // when the computation is unavailable would restore exactly that bug, so
  // there is none: an uncomputable figure makes the forecast unavailable and
  // says which figure it was.
  const operatingFigures: SnapshotOperatingFiguresReadModel = {
    costs: computeOperatingCostFigures(snapshot),
    margin: computeOperatingMarginFigures(snapshot),
  };
  const latest = latestLiquidityBaseline(snapshot.liquidityBaselines);
  const missingFields: SnapshotLiquidityMissingField[] = [];
  if (latest === undefined) missingFields.push("liquidityBaseline");
  if (operatingFigures.costs.status !== "available") {
    missingFields.push("trailing12mOperatingCosts");
  }
  if (operatingFigures.margin.status !== "available") {
    missingFields.push("operatingMargin");
  }

  const liquidity: SnapshotLiquidityReadModel = latest === undefined ||
      operatingFigures.costs.status !== "available" ||
      operatingFigures.margin.status !== "available"
    ? { status: "unavailable", missingFields }
    : {
        status: "available",
        baselineId: latest.id,
        baselineAsOfDate: latest.asOfDate,
        forecast: buildLiquidityForecast({
          projection,
          horizon,
          currentCash: latest.currentCash,
          trailing12mOperatingCosts:
            operatingFigures.costs.trailing12mOperatingCosts,
          currentAnnualRepairCollection: operatingFigures.margin.operatingMargin,
          ...(snapshot.housingCompany.operatingBuffer === undefined
            ? {}
            : { operatingBufferSettings: snapshot.housingCompany.operatingBuffer }),
          ...(snapshot.housingCompany.chargeableAreaM2 === undefined
            ? {}
            : { totalChargeableAreaM2: snapshot.housingCompany.chargeableAreaM2 }),
          apartmentCount: snapshot.housingCompany.apartmentCount,
          ...(snapshot.housingCompany.maintenancePlanCoverageThroughYear ===
              undefined
            ? {}
            : {
                maintenancePlanCoverageThroughYear:
                  snapshot.housingCompany.maintenancePlanCoverageThroughYear,
              }),
        }),
      };
  return structuredClone({ horizon, projection, operatingFigures, liquidity });
}

export function latestLiquidityBaseline(
  baselines: readonly LiquidityBaselineRecord[],
): LiquidityBaselineRecord | undefined {
  const latest = [...baselines]
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.id.localeCompare(b.id))
    .at(-1);
  return latest === undefined ? undefined : structuredClone(latest);
}
