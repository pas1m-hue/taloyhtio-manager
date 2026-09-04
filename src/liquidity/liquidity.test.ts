import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  type ScenarioProjection,
} from "../domain/types.js";
import { buildProjection } from "../projection/buildProjection.js";
import {
  condensationAsset,
  condensationCostEvidence,
  condensationEvents,
} from "../fixtures/condensationDamage.js";
import { correctedWorkbookLiquidityBaseline } from "../fixtures/liquidityBaseline.js";
import {
  waterHeaterAsset,
  waterHeaterCostEvidence,
  waterHeaterExplicitScheduleEvent,
} from "../fixtures/waterHeaters.js";
import { buildLiquidityForecast } from "./buildLiquidityForecast.js";
import { calculateRequiredCollection } from "./calculateRequiredCollection.js";
import { findFundingNeed } from "./findFundingNeed.js";
import { calculateOperatingBuffer } from "./operatingBuffer.js";
import { projectCashPath } from "./projectCashPath.js";

const waterHeaterHorizon = { startYear: 2027, endYear: 2039 } as const;

function waterHeaterProjection(): ReturnType<typeof buildProjection> {
  return buildProjection({
    assets: [waterHeaterAsset],
    events: [waterHeaterExplicitScheduleEvent],
    costEvidence: [waterHeaterCostEvidence],
    horizon: waterHeaterHorizon,
  });
}

function workbookBuffer(): ReturnType<typeof calculateOperatingBuffer> {
  return calculateOperatingBuffer({
    trailing12mOperatingCosts:
      correctedWorkbookLiquidityBaseline.trailing12mOperatingCosts,
  });
}

function expectDomainError(
  action: () => unknown,
  code: DomainValidationError["code"],
): void {
  try {
    action();
    throw new Error("Expected DomainValidationError");
  } catch (error) {
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as DomainValidationError).code).toBe(code);
  }
}

function simpleProjection(overrides: Partial<ScenarioProjection> = {}): ScenarioProjection {
  return {
    scenario: "base",
    years: [{
      year: 2027,
      eventCount: 1,
      quantity: 0,
      amount: 12_000,
      events: [],
      dataGaps: [],
    }],
    horizonEventCount: 1,
    horizonQuantity: 0,
    horizonAmount: 12_000,
    beforeHorizonEventCount: 0,
    beforeHorizonQuantity: 0,
    beforeHorizonAmount: 0,
    afterHorizonEventCount: 0,
    afterHorizonQuantity: 0,
    afterHorizonAmount: 0,
    dataGaps: {
      beforeHorizon: [],
      withinHorizon: [],
      afterHorizon: [],
    },
    ...overrides,
  };
}

describe("calculateOperatingBuffer", () => {
  it("uses the locked 3.5-month default with the corrected workbook baseline", () => {
    expect(workbookBuffer()).toEqual({
      bufferMonths: 3.5,
      suggestedOperatingBuffer: 9_925.26,
      operatingBufferTarget: 9_925.26,
      basis: "suggested",
    });
  });

  it("lets the explicit user override replace the suggestion", () => {
    expect(calculateOperatingBuffer({
      trailing12mOperatingCosts: 34_029.46,
      settings: { bufferMonths: 4, userOverride: 12_000 },
    })).toEqual({
      bufferMonths: 4,
      suggestedOperatingBuffer: 11_343.15,
      operatingBufferTarget: 12_000,
      basis: "user_override",
    });
  });

  it("rejects negative and non-finite buffer inputs", () => {
    expectDomainError(
      () => calculateOperatingBuffer({ trailing12mOperatingCosts: -1 }),
      "INVALID_OPERATING_BUFFER",
    );
    expectDomainError(
      () => calculateOperatingBuffer({
        trailing12mOperatingCosts: 1_000,
        settings: { bufferMonths: Number.POSITIVE_INFINITY },
      }),
      "INVALID_OPERATING_BUFFER",
    );
    expectDomainError(
      () => calculateOperatingBuffer({
        trailing12mOperatingCosts: 1_000,
        settings: { userOverride: -1 },
      }),
      "INVALID_OPERATING_BUFFER",
    );
  });
});

describe("projectCashPath and findFundingNeed", () => {
  it("builds every horizon year and preserves the real base repair costs", () => {
    const projection = waterHeaterProjection().scenarios.base;
    const path = projectCashPath({
      projection,
      horizon: waterHeaterHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      annualRepairCollection: 0,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
    });

    expect(path.years).toHaveLength(13);
    expect(path.knownRepairCostsTotal).toBe(19_800);
    expect(path.years[0]).toMatchObject({
      year: 2027,
      openingCash: 22_208.49,
      knownRepairCosts: 1_650,
      closingCash: 20_558.49,
      bufferShortfall: 0,
    });
    expect(path.years.find((year) => year.year === 2031)).toMatchObject({
      knownRepairCosts: 3_300,
      closingCash: 9_008.49,
      bufferShortfall: 916.77,
    });
    expect(path.finalCash).toBe(2_408.49);
  });

  it("signals the first and maximum known-cost funding need without assuming a loan", () => {
    const path = projectCashPath({
      projection: waterHeaterProjection().scenarios.base,
      horizon: waterHeaterHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      annualRepairCollection: 0,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
    });

    expect(findFundingNeed(path)).toEqual({
      scenario: "base",
      ownFundingSufficientForKnownCosts: false,
      forecastComplete: true,
      amountAtFirstNeed: 916.77,
      maximumBufferShortfall: 7_516.77,
      minimumClosingCash: 2_408.49,
      blockingDataGaps: [],
      firstFundingNeedYear: 2031,
    });
  });

  it("shows that the corrected-workbook repair-budget proxy covers known heater costs", () => {
    const path = projectCashPath({
      projection: waterHeaterProjection().scenarios.base,
      horizon: waterHeaterHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      annualRepairCollection:
        correctedWorkbookLiquidityBaseline.currentAnnualRepairCollection,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
    });
    const signal = findFundingNeed(path);

    expect(signal.ownFundingSufficientForKnownCosts).toBe(true);
    expect(signal.firstFundingNeedYear).toBeUndefined();
    expect(signal.maximumBufferShortfall).toBe(0);
    expect(path.collectionTotal).toBe(125_840);
  });

  it("keeps a named DATA GAP visible and marks the forecast incomplete", () => {
    const projection = buildProjection({
      assets: [condensationAsset],
      events: condensationEvents,
      costEvidence: condensationCostEvidence,
      horizon: { startYear: 2026, endYear: 2030 },
    });
    const path = projectCashPath({
      projection: projection.scenarios.stress,
      horizon: { startYear: 2026, endYear: 2030 },
      initialCash: 10_000,
      annualRepairCollection: 0,
      operatingBufferTarget: 5_000,
    });
    const signal = findFundingNeed(path);

    expect(path.knownRepairCostsTotal).toBe(4_635);
    expect(path.years[0]?.dataGaps).toHaveLength(1);
    expect(path.years[0]?.knownRepairCosts).toBe(4_635);
    expect(signal.forecastComplete).toBe(false);
    expect(signal.blockingDataGaps).toHaveLength(1);
    expect(signal.ownFundingSufficientForKnownCosts).toBe(true);
  });

  it("is deterministic for reversed projection-year input and does not mutate it", () => {
    const original = waterHeaterProjection().scenarios.base;
    const reversed: ScenarioProjection = {
      ...original,
      years: [...original.years].reverse(),
    };
    const before = JSON.stringify(reversed);
    const common = {
      horizon: waterHeaterHorizon,
      initialCash: 22_208.49,
      annualRepairCollection: 1_000,
      operatingBufferTarget: 9_925.26,
    } as const;

    expect(projectCashPath({ projection: reversed, ...common }))
      .toEqual(projectCashPath({ projection: original, ...common }));
    expect(JSON.stringify(reversed)).toBe(before);
  });

  it("rejects an internally inconsistent projection instead of trusting its total", () => {
    expectDomainError(
      () => projectCashPath({
        projection: simpleProjection({ horizonAmount: 11_999 }),
        horizon: { startYear: 2027, endYear: 2030 },
        initialCash: 10_000,
        annualRepairCollection: 1_000,
        operatingBufferTarget: 5_000,
      }),
      "INVALID_SCENARIO_PROJECTION",
    );
  });
});

describe("maintenance plan coverage in the cash path", () => {
  const coverageHorizon = { startYear: 2027, endYear: 2039 } as const;

  function optimisticPath(coverage?: number) {
    return projectCashPath({
      projection: waterHeaterProjection().scenarios.optimistic,
      horizon: coverageHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      annualRepairCollection: 1_000,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
      ...(coverage === undefined
        ? {}
        : { maintenancePlanCoverageThroughYear: coverage }),
    });
  }

  it("keeps a genuine zero inside the coverage a zero", () => {
    // The whole point of the feature: 2028 has no planned repair and 2035 is
    // not planned at all. Before this they rendered identically.
    const path = optimisticPath(2033);

    const genuineZero = path.years.find((year) => year.year === 2028);
    expect(genuineZero).toMatchObject({
      costsKnown: true,
      knownRepairCosts: 0,
      bufferShortfall: 0,
    });
    expect(genuineZero?.closingCash).toBeTypeOf("number");
    expect(genuineZero?.dataGaps).toEqual([]);

    const unplanned = path.years.find((year) => year.year === 2035);
    expect(unplanned).toMatchObject({ year: 2035, costsKnown: false });
    expect(unplanned?.knownRepairCosts).toBeUndefined();
    expect(unplanned?.closingCash).toBeUndefined();
    expect(unplanned?.bufferShortfall).toBeUndefined();
    expect(unplanned?.cashAboveBuffer).toBeUndefined();
    expect(unplanned?.dataGaps).toBeUndefined();
  });

  it("computes covered years, marks the rest and keeps every year visible", () => {
    const path = optimisticPath(2033);

    expect(path.years).toHaveLength(13);
    expect(path.years.filter((year) => year.costsKnown).map((year) => year.year))
      .toEqual([2027, 2028, 2029, 2030, 2031, 2032, 2033]);
    expect(path.years.filter((year) => !year.costsKnown).map((year) => year.year))
      .toEqual([2034, 2035, 2036, 2037, 2038, 2039]);
    expect(path.maintenancePlanCoverageThroughYear).toBe(2033);
  });

  it("breaks the opening-cash chain exactly once, at the coverage edge", () => {
    const path = optimisticPath(2033);

    const lastCovered = path.years.find((year) => year.year === 2033);
    const firstUncovered = path.years.find((year) => year.year === 2034);
    // 2034's opening cash is 2033's closing cash - known, so it is shown.
    expect(firstUncovered?.openingCash).toBe(lastCovered?.closingCash);
    expect(path.years.find((year) => year.year === 2035)?.openingCash)
      .toBeUndefined();
  });

  it("counts what it leaves out instead of dropping it silently", () => {
    // Optimistic schedules 2036 and 2039 past a 2033 coverage: those rows are
    // real, they just cannot complete an uncovered year's total.
    const path = optimisticPath(2033);

    expect(path.beyondCoverage).toEqual({
      firstYear: 2034,
      yearCount: 6,
      scheduledCostTotal: 3_300,
    });
    // 2027, 2030 and 2033 are inside the coverage; 2036 and 2039 are not.
    expect(path.knownRepairCostsTotal).toBe(4_950);
    expect(path.finalCash).toBeUndefined();
  });

  it("computes every year when no coverage is set, exactly as before", () => {
    const withoutCoverage = optimisticPath();
    const legacyShape = projectCashPath({
      projection: waterHeaterProjection().scenarios.optimistic,
      horizon: coverageHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      annualRepairCollection: 1_000,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
    });

    expect(withoutCoverage).toEqual(legacyShape);
    expect(withoutCoverage.years.every((year) => year.costsKnown)).toBe(true);
    expect(withoutCoverage.maintenancePlanCoverageThroughYear).toBeUndefined();
    expect(withoutCoverage.beyondCoverage).toBeUndefined();
    expect(withoutCoverage.finalCash).toBeTypeOf("number");
  });

  it("computes every year when the coverage reaches past the horizon", () => {
    const path = optimisticPath(2060);

    expect(path.years.every((year) => year.costsKnown)).toBe(true);
    expect(path.beyondCoverage).toBeUndefined();
    expect(path.finalCash).toBe(optimisticPath().finalCash);
  });

  it("marks every year when the coverage already lapsed", () => {
    const path = optimisticPath(2020);

    expect(path.years.every((year) => !year.costsKnown)).toBe(true);
    expect(path.years[0]?.openingCash).toBe(22_208.49);
    expect(path.years[1]?.openingCash).toBeUndefined();
    expect(path.knownRepairCostsTotal).toBe(0);
    expect(path.finalCash).toBeUndefined();
    expect(path.beyondCoverage).toEqual({
      firstYear: 2027,
      yearCount: 13,
      scheduledCostTotal: 8_250,
    });
  });

  it("rejects a coverage year that is not a year", () => {
    expectDomainError(
      () => optimisticPath(2033.5),
      "INVALID_MAINTENANCE_PLAN_COVERAGE",
    );
  });

  it("does not read an uncovered year as a satisfied buffer", () => {
    // The guard that matters: `undefined > 0` is false and Math.min with an
    // undefined is NaN, so an unguarded scan would report "no funding need"
    // and a NaN minimum without ever throwing.
    const path = projectCashPath({
      projection: waterHeaterProjection().scenarios.base,
      horizon: coverageHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      annualRepairCollection: 0,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
      maintenancePlanCoverageThroughYear: 2031,
    });
    const signal = findFundingNeed(path);

    expect(signal.firstFundingNeedYear).toBe(2031);
    expect(signal.ownFundingSufficientForKnownCosts).toBe(false);
    expect(Number.isNaN(signal.minimumClosingCash)).toBe(false);
    expect(signal.minimumClosingCash).toBe(9_008.49);
    expect(Number.isNaN(signal.maximumBufferShortfall)).toBe(false);
    expect(signal.maximumBufferShortfall).toBe(916.77);
  });

  it("reports no funding need from covered years alone when they hold", () => {
    const signal = findFundingNeed(optimisticPath(2020));

    // Nothing is known at all, so nothing may claim a shortfall - and the
    // minimum closing cash falls back to the initial cash rather than NaN.
    expect(signal.ownFundingSufficientForKnownCosts).toBe(true);
    expect(signal.maximumBufferShortfall).toBe(0);
    expect(signal.minimumClosingCash).toBe(22_208.49);
  });
});

describe("calculateRequiredCollection", () => {
  it("solves the minimum flat annual collection for the real heater base path", () => {
    const result = calculateRequiredCollection({
      projection: waterHeaterProjection().scenarios.base,
      horizon: waterHeaterHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
      currentAnnualRepairCollection: 0,
    });

    expect(result).toMatchObject({
      scenario: "base",
      knownCostRequiredAnnualCollection: 835.2,
      currentAnnualRepairCollection: 0,
      additionalAnnualCollection: 835.2,
      currentMonthlyCollection: 0,
      requiredMonthlyCollection: 69.6,
      additionalMonthlyCollection: 69.6,
      planningYearCount: 13,
      forecastComplete: true,
      blockingDataGaps: [],
    });
  });

  it("reports only the additional collection above the current level", () => {
    const result = calculateRequiredCollection({
      projection: simpleProjection(),
      horizon: { startYear: 2027, endYear: 2029 },
      initialCash: 10_000,
      operatingBufferTarget: 5_000,
      currentAnnualRepairCollection: 2_000,
    });

    expect(result.knownCostRequiredAnnualCollection).toBe(7_000);
    expect(result.additionalAnnualCollection).toBe(5_000);
    expect(result.currentMonthlyCollection).toBe(166.67);
    expect(result.requiredMonthlyCollection).toBe(583.34);
    expect(result.additionalMonthlyCollection).toBe(416.67);
  });

  it("returns zero additional collection when the current level already suffices", () => {
    const result = calculateRequiredCollection({
      projection: waterHeaterProjection().scenarios.base,
      horizon: waterHeaterHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
      currentAnnualRepairCollection:
        correctedWorkbookLiquidityBaseline.currentAnnualRepairCollection,
    });

    expect(result.knownCostRequiredAnnualCollection).toBe(835.2);
    expect(result.additionalAnnualCollection).toBe(0);
    expect(result.additionalMonthlyCollection).toBe(0);
  });

  it("derives monthly per-square-metre and per-apartment planning values", () => {
    const result = calculateRequiredCollection({
      projection: simpleProjection(),
      horizon: { startYear: 2027, endYear: 2029 },
      initialCash: 10_000,
      operatingBufferTarget: 5_000,
      currentAnnualRepairCollection: 2_000,
      totalChargeableAreaM2: 1_000,
      apartmentCount: 20,
    });

    expect(result.currentMonthlyPerM2).toBe(0.1667);
    expect(result.requiredMonthlyPerM2).toBe(0.5833);
    expect(result.additionalMonthlyPerM2).toBe(0.4167);
    expect(result.currentMonthlyPerApartment).toBe(8.3333);
    expect(result.requiredMonthlyPerApartment).toBe(29.1667);
    expect(result.additionalMonthlyPerApartment).toBe(20.8333);
  });

  it("keeps optimistic, base, and stress collection requirements separate", () => {
    const projection = waterHeaterProjection();
    const common = {
      horizon: waterHeaterHorizon,
      initialCash: correctedWorkbookLiquidityBaseline.currentCash,
      operatingBufferTarget: workbookBuffer().operatingBufferTarget,
      currentAnnualRepairCollection: 0,
    } as const;

    const optimistic = calculateRequiredCollection({
      projection: projection.scenarios.optimistic,
      ...common,
    });
    const base = calculateRequiredCollection({
      projection: projection.scenarios.base,
      ...common,
    });
    const stress = calculateRequiredCollection({
      projection: projection.scenarios.stress,
      ...common,
    });

    expect(optimistic.knownCostRequiredAnnualCollection).toBe(0);
    expect(base.knownCostRequiredAnnualCollection).toBe(835.2);
    expect(stress.knownCostRequiredAnnualCollection).toBe(1_252.8);
  });

  it("marks DATA GAP scenarios as known-cost lower bounds", () => {
    const projection = buildProjection({
      assets: [condensationAsset],
      events: condensationEvents,
      costEvidence: condensationCostEvidence,
      horizon: { startYear: 2026, endYear: 2030 },
    });
    const result = calculateRequiredCollection({
      projection: projection.scenarios.stress,
      horizon: { startYear: 2026, endYear: 2030 },
      initialCash: 10_000,
      operatingBufferTarget: 5_000,
      currentAnnualRepairCollection: 0,
    });

    expect(result.forecastComplete).toBe(false);
    expect(result.blockingDataGaps).toHaveLength(1);
    expect(result.knownCostRequiredAnnualCollection).toBe(0);
  });

  it("returns a cent-minimal collection that preserves the buffer in every year", () => {
    const cases = [
      { initialCash: 0, buffer: 5_000, amounts: [2_000, 0, 10_000] },
      { initialCash: 8_000, buffer: 4_000, amounts: [0, 12_000, 1_000] },
      { initialCash: 20_000, buffer: 10_000, amounts: [4_000, 8_000, 9_000] },
    ] as const;

    for (const [caseIndex, item] of cases.entries()) {
      const years = item.amounts.map((amount, index) => ({
        year: 2027 + index,
        eventCount: amount === 0 ? 0 : 1,
        quantity: 0,
        amount,
        events: [],
        dataGaps: [],
      }));
      const projection = simpleProjection({
        years,
        horizonAmount: item.amounts.reduce<number>((sum, amount) => sum + amount, 0),
        horizonEventCount: years.reduce((sum, year) => sum + year.eventCount, 0),
      });
      const horizon = { startYear: 2027, endYear: 2029 } as const;
      const required = calculateRequiredCollection({
        projection,
        horizon,
        initialCash: item.initialCash,
        operatingBufferTarget: item.buffer,
        currentAnnualRepairCollection: 0,
      });
      const exactPath = projectCashPath({
        projection,
        horizon,
        initialCash: item.initialCash,
        annualRepairCollection: required.knownCostRequiredAnnualCollection,
        operatingBufferTarget: item.buffer,
      });

      expect(
        exactPath.years.every((year) => year.bufferShortfall === 0),
        `case ${caseIndex} should preserve the buffer`,
      ).toBe(true);

      if (required.knownCostRequiredAnnualCollection > 0) {
        const lowerPath = projectCashPath({
          projection,
          horizon,
          initialCash: item.initialCash,
          annualRepairCollection:
            required.knownCostRequiredAnnualCollection - 0.01,
          operatingBufferTarget: item.buffer,
        });
        expect(
          lowerPath.years.some((year) => (year.bufferShortfall ?? 0) > 0),
          `case ${caseIndex} should fail one cent below the minimum`,
        ).toBe(true);
      }
    }
  });

  it("rejects invalid charge bases and negative financial inputs", () => {
    expectDomainError(
      () => calculateRequiredCollection({
        projection: simpleProjection(),
        horizon: { startYear: 2027, endYear: 2029 },
        initialCash: 10_000,
        operatingBufferTarget: 5_000,
        currentAnnualRepairCollection: 0,
        totalChargeableAreaM2: 0,
      }),
      "INVALID_CHARGE_BASIS",
    );
    expectDomainError(
      () => calculateRequiredCollection({
        projection: simpleProjection(),
        horizon: { startYear: 2027, endYear: 2029 },
        initialCash: -1,
        operatingBufferTarget: 5_000,
        currentAnnualRepairCollection: 0,
      }),
      "INVALID_CASH_INPUT",
    );
  });
});


describe("buildLiquidityForecast", () => {
  it("builds all three isolated scenario forecasts with one app-facing call", () => {
    const result = buildLiquidityForecast({
      projection: waterHeaterProjection(),
      horizon: waterHeaterHorizon,
      currentCash: correctedWorkbookLiquidityBaseline.currentCash,
      trailing12mOperatingCosts:
        correctedWorkbookLiquidityBaseline.trailing12mOperatingCosts,
      currentAnnualRepairCollection: 0,
      totalChargeableAreaM2: 1_000,
      apartmentCount: 20,
    });

    expect(result.operatingBuffer.operatingBufferTarget).toBe(9_925.26);
    expect(result.scenarios.optimistic.requiredCollection
      .knownCostRequiredAnnualCollection).toBe(0);
    expect(result.scenarios.base.requiredCollection
      .knownCostRequiredAnnualCollection).toBe(835.2);
    expect(result.scenarios.stress.requiredCollection
      .knownCostRequiredAnnualCollection).toBe(1_252.8);
    expect(result.scenarios.base.fundingNeed.firstFundingNeedYear).toBe(2031);
    expect(result.scenarios.stress.fundingNeed.firstFundingNeedYear).toBe(2030);
  });

  it("does not mutate the projection or financial inputs", () => {
    const input = {
      projection: waterHeaterProjection(),
      horizon: waterHeaterHorizon,
      currentCash: 22_208.49,
      trailing12mOperatingCosts: 34_029.46,
      currentAnnualRepairCollection: 1_000,
    } as const;
    const before = JSON.stringify(input);

    buildLiquidityForecast(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});
