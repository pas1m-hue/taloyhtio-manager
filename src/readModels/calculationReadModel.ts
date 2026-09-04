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

export type SnapshotLiquidityReadModel =
  | {
      readonly status: "available";
      readonly baselineId: string;
      readonly baselineAsOfDate: string;
      readonly forecast: LiquidityForecastResult;
    }
  | {
      readonly status: "unavailable";
      readonly missingFields: readonly ["liquidityBaseline"];
    };

export interface SnapshotCalculationReadModel {
  readonly horizon: Horizon;
  readonly projection: ProjectionResult;
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
  const latest = latestLiquidityBaseline(snapshot.liquidityBaselines);
  const liquidity: SnapshotLiquidityReadModel = latest === undefined
    ? { status: "unavailable", missingFields: ["liquidityBaseline"] }
    : {
        status: "available",
        baselineId: latest.id,
        baselineAsOfDate: latest.asOfDate,
        forecast: buildLiquidityForecast({
          projection,
          horizon,
          currentCash: latest.currentCash,
          trailing12mOperatingCosts: latest.trailing12mOperatingCosts,
          currentAnnualRepairCollection: latest.currentAnnualRepairCollection,
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
  return structuredClone({ horizon, projection, liquidity });
}

export function latestLiquidityBaseline(
  baselines: readonly LiquidityBaselineRecord[],
): LiquidityBaselineRecord | undefined {
  const latest = [...baselines]
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate) || a.id.localeCompare(b.id))
    .at(-1);
  return latest === undefined ? undefined : structuredClone(latest);
}
