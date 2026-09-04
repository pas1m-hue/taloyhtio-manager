import {
  SCENARIOS,
  type EffectiveSessionLiquidityAssumptions,
  type LiquidityForecastResult,
  type OperatingBufferSettings,
  type ProjectionResult,
  type PublishedDataSnapshot,
  type Scenario,
  type ScenarioLiquidityForecast,
  type SessionLiquidityModel,
  type VisitorSessionWorkspace,
} from "../domain/types.js";
import { calculateRequiredCollection } from "../liquidity/calculateRequiredCollection.js";
import { findFundingNeed } from "../liquidity/findFundingNeed.js";
import { calculateOperatingBuffer } from "../liquidity/operatingBuffer.js";
import { projectCashPath } from "../liquidity/projectCashPath.js";

export function buildSessionLiquidityModel(
  publication: PublishedDataSnapshot,
  workspace: VisitorSessionWorkspace,
  projection: ProjectionResult,
): SessionLiquidityModel {
  const latest = [...publication.liquidityBaselines]
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
    .at(-1);
  const overrides = workspace.liquidityOverrides;
  const missing: (
    | "currentCash"
    | "trailing12mOperatingCosts"
    | "currentAnnualRepairCollection"
  )[] = [];

  const currentCash = overrides.currentCash ?? latest?.currentCash;
  if (currentCash === undefined) missing.push("currentCash");
  const trailing12mOperatingCosts =
    overrides.trailing12mOperatingCosts ?? latest?.trailing12mOperatingCosts;
  if (trailing12mOperatingCosts === undefined) {
    missing.push("trailing12mOperatingCosts");
  }

  const publishedCollection = latest?.currentAnnualRepairCollection;
  const annualOverrides = overrides.annualRepairCollectionByScenario ?? {};
  if (publishedCollection === undefined &&
      SCENARIOS.some((scenario) => annualOverrides[scenario] === undefined)) {
    missing.push("currentAnnualRepairCollection");
  }
  if (currentCash === undefined || trailing12mOperatingCosts === undefined ||
      missing.includes("currentAnnualRepairCollection")) {
    return { status: "unavailable", missingFields: missing };
  }

  const annualRepairCollectionByScenario = {
    optimistic: annualOverrides.optimistic ?? publishedCollection!,
    base: annualOverrides.base ?? publishedCollection!,
    stress: annualOverrides.stress ?? publishedCollection!,
  };
  const operatingBufferSettings = effectiveOperatingBufferSettings(
    publication,
    workspace,
  );
  const assumptions: EffectiveSessionLiquidityAssumptions = {
    currentCash,
    trailing12mOperatingCosts,
    operatingBufferSettings,
    ...(overrides.totalChargeableAreaM2 ??
      publication.housingCompany.chargeableAreaM2) === undefined
      ? {}
      : {
          totalChargeableAreaM2: overrides.totalChargeableAreaM2 ??
            publication.housingCompany.chargeableAreaM2,
        },
    apartmentCount: overrides.apartmentCount ??
      publication.housingCompany.apartmentCount,
    annualRepairCollectionByScenario,
  };
  return {
    status: "available",
    assumptions,
    forecast: buildForecast(
      projection,
      workspace,
      assumptions,
      publication.housingCompany.maintenancePlanCoverageThroughYear,
    ),
  };
}

function buildForecast(
  projection: ProjectionResult,
  workspace: VisitorSessionWorkspace,
  assumptions: EffectiveSessionLiquidityAssumptions,
  maintenancePlanCoverageThroughYear: number | undefined,
): LiquidityForecastResult {
  const operatingBuffer = calculateOperatingBuffer({
    trailing12mOperatingCosts: assumptions.trailing12mOperatingCosts,
    settings: assumptions.operatingBufferSettings,
  });
  const scenarios = {} as Record<Scenario, ScenarioLiquidityForecast>;
  for (const scenario of SCENARIOS) {
    const annualRepairCollection =
      assumptions.annualRepairCollectionByScenario[scenario];
    const scenarioProjection = projection.scenarios[scenario];
    const cashPath = projectCashPath({
      projection: scenarioProjection,
      horizon: workspace.horizon,
      initialCash: assumptions.currentCash,
      annualRepairCollection,
      operatingBufferTarget: operatingBuffer.operatingBufferTarget,
      ...(maintenancePlanCoverageThroughYear === undefined
        ? {}
        : { maintenancePlanCoverageThroughYear }),
    });
    const requiredCollection = calculateRequiredCollection({
      projection: scenarioProjection,
      horizon: workspace.horizon,
      initialCash: assumptions.currentCash,
      operatingBufferTarget: operatingBuffer.operatingBufferTarget,
      currentAnnualRepairCollection: annualRepairCollection,
      ...(assumptions.totalChargeableAreaM2 === undefined
        ? {}
        : { totalChargeableAreaM2: assumptions.totalChargeableAreaM2 }),
      ...(assumptions.apartmentCount === undefined
        ? {}
        : { apartmentCount: assumptions.apartmentCount }),
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

function effectiveOperatingBufferSettings(
  publication: PublishedDataSnapshot,
  workspace: VisitorSessionWorkspace,
): OperatingBufferSettings {
  const published = publication.housingCompany.operatingBuffer;
  const overrides = workspace.liquidityOverrides;
  const bufferMonths = overrides.bufferMonths ?? published?.bufferMonths;
  const hasTargetOverride = Object.hasOwn(overrides, "operatingBufferTarget");
  const userOverride = hasTargetOverride
    ? overrides.operatingBufferTarget === null
      ? undefined
      : overrides.operatingBufferTarget
    : published?.userOverride;
  return {
    ...(bufferMonths === undefined ? {} : { bufferMonths }),
    ...(userOverride === undefined ? {} : { userOverride }),
  };
}
