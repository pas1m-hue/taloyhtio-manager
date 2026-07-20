import {
  SCENARIOS,
  type Horizon,
  type LiquidityForecastResult,
  type OperatingBufferSettings,
  type ProjectionResult,
  type Scenario,
  type ScenarioLiquidityForecast,
} from "../domain/types.js";
import { calculateRequiredCollection } from "./calculateRequiredCollection.js";
import { findFundingNeed } from "./findFundingNeed.js";
import { calculateOperatingBuffer } from "./operatingBuffer.js";
import { projectCashPath } from "./projectCashPath.js";

export interface BuildLiquidityForecastInput {
  readonly projection: ProjectionResult;
  readonly horizon: Horizon;
  readonly currentCash: number;
  readonly trailing12mOperatingCosts: number;
  readonly currentAnnualRepairCollection: number;
  readonly operatingBufferSettings?: OperatingBufferSettings;
  readonly totalChargeableAreaM2?: number;
  readonly apartmentCount?: number;
}

/**
 * App-facing V1.9 composition: one protected buffer and three isolated
 * scenario forecasts. It identifies funding pressure but never chooses a loan
 * or any other financing instrument.
 */
export function buildLiquidityForecast(
  input: BuildLiquidityForecastInput,
): LiquidityForecastResult {
  const operatingBuffer = calculateOperatingBuffer({
    trailing12mOperatingCosts: input.trailing12mOperatingCosts,
    ...(input.operatingBufferSettings === undefined
      ? {}
      : { settings: input.operatingBufferSettings }),
  });
  const scenarios = {} as Record<Scenario, ScenarioLiquidityForecast>;

  for (const scenario of SCENARIOS) {
    const projection = input.projection.scenarios[scenario];
    const cashPath = projectCashPath({
      projection,
      horizon: input.horizon,
      initialCash: input.currentCash,
      annualRepairCollection: input.currentAnnualRepairCollection,
      operatingBufferTarget: operatingBuffer.operatingBufferTarget,
    });
    const requiredCollection = calculateRequiredCollection({
      projection,
      horizon: input.horizon,
      initialCash: input.currentCash,
      operatingBufferTarget: operatingBuffer.operatingBufferTarget,
      currentAnnualRepairCollection: input.currentAnnualRepairCollection,
      ...(input.totalChargeableAreaM2 === undefined
        ? {}
        : { totalChargeableAreaM2: input.totalChargeableAreaM2 }),
      ...(input.apartmentCount === undefined
        ? {}
        : { apartmentCount: input.apartmentCount }),
    });
    scenarios[scenario] = {
      cashPath,
      fundingNeed: findFundingNeed(cashPath),
      requiredCollection,
    };
  }

  return {
    operatingBuffer,
    scenarios: {
      optimistic: scenarios.optimistic,
      base: scenarios.base,
      stress: scenarios.stress,
    },
  };
}
