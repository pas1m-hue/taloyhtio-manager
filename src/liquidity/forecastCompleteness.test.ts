import { describe, expect, it } from "vitest";
import type { EventDataGap, Horizon } from "../domain/types.js";
import { buildProjection } from "../projection/buildProjection.js";
import { calculateRequiredCollection } from "./calculateRequiredCollection.js";
import { findFundingNeed } from "./findFundingNeed.js";
import { forecastIncompletenessReasons } from "./forecastCompleteness.js";
import { projectCashPath } from "./projectCashPath.js";
import {
  waterHeaterAsset,
  waterHeaterCostEvidence,
  waterHeaterExplicitScheduleEvent,
} from "../fixtures/waterHeaters.js";

const HORIZON: Horizon = { startYear: 2027, endYear: 2050 };

function baseProjection(horizon: Horizon = HORIZON) {
  return buildProjection({
    assets: [waterHeaterAsset],
    events: [waterHeaterExplicitScheduleEvent],
    costEvidence: [waterHeaterCostEvidence],
    horizon,
  }).scenarios.base;
}

function requiredCollection(coverage?: number) {
  return calculateRequiredCollection({
    projection: baseProjection(),
    horizon: HORIZON,
    initialCash: 20_000,
    operatingBufferTarget: 5_000,
    currentAnnualRepairCollection: 1_000,
    ...(coverage === undefined ? {} : { maintenancePlanCoverageThroughYear: coverage }),
  });
}

function fundingNeed(coverage?: number) {
  const cashPath = projectCashPath({
    projection: baseProjection(),
    horizon: HORIZON,
    initialCash: 20_000,
    annualRepairCollection: 1_000,
    operatingBufferTarget: 5_000,
    ...(coverage === undefined ? {} : { maintenancePlanCoverageThroughYear: coverage }),
  });
  return { cashPath, signal: findFundingNeed(cashPath, HORIZON) };
}

const gap: EventDataGap = {
  eventId: "event_x",
  scheduleEntryId: "entry_x",
  assetId: "asset_x",
  title: "Kustannus puuttuu",
  scenario: "base",
  year: 2030,
  costEvidenceId: "gap_x",
  horizonPosition: "within",
  reason: "Kustannusnäyttö on DATA GAP.",
};

describe("forecastIncompletenessReasons", () => {
  it("reports nothing when there are no gaps and the plan reaches the horizon's end", () => {
    expect(forecastIncompletenessReasons({
      blockingDataGaps: [],
      horizon: HORIZON,
      maintenancePlanCoverageThroughYear: 2050,
    })).toEqual([]);
  });

  it("accepts a plan reaching past the horizon's end", () => {
    expect(forecastIncompletenessReasons({
      blockingDataGaps: [],
      horizon: HORIZON,
      maintenancePlanCoverageThroughYear: 2060,
    })).toEqual([]);
  });

  it("reports coverage_ends_before_horizon when the plan stops short", () => {
    expect(forecastIncompletenessReasons({
      blockingDataGaps: [],
      horizon: HORIZON,
      maintenancePlanCoverageThroughYear: 2030,
    })).toEqual(["coverage_ends_before_horizon"]);
  });

  it("reports coverage_unset when nobody has said how far the plan reaches", () => {
    expect(forecastIncompletenessReasons({ blockingDataGaps: [], horizon: HORIZON }))
      .toEqual(["coverage_unset"]);
  });

  it("reports data_gap regardless of coverage", () => {
    expect(forecastIncompletenessReasons({
      blockingDataGaps: [gap],
      horizon: HORIZON,
      maintenancePlanCoverageThroughYear: 2050,
    })).toEqual(["data_gap"]);
  });

  it("reports both reasons when both apply, because they need different work", () => {
    expect(forecastIncompletenessReasons({
      blockingDataGaps: [gap],
      horizon: HORIZON,
      maintenancePlanCoverageThroughYear: 2030,
    })).toEqual(["data_gap", "coverage_ends_before_horizon"]);
  });

  it("never reports both coverage reasons at once", () => {
    for (const coverage of [undefined, 2030, 2050, 2060]) {
      const reasons = forecastIncompletenessReasons({
        blockingDataGaps: [],
        horizon: HORIZON,
        ...(coverage === undefined ? {} : { maintenancePlanCoverageThroughYear: coverage }),
      });
      expect(reasons.filter((r) => r.startsWith("coverage")).length).toBeLessThan(2);
    }
  });
});

describe("forecastComplete no longer claims more than the plan covers", () => {
  it("is false when the plan stops before the horizon, with no DATA GAPs", () => {
    // The production case: coverage 2030 against a horizon reaching 2050, no
    // gaps anywhere, and the view said "Ennuste täydellinen".
    expect(requiredCollection(2030).forecastComplete).toBe(false);
    expect(requiredCollection(2030).forecastIncompleteReasons)
      .toEqual(["coverage_ends_before_horizon"]);
    expect(fundingNeed(2030).signal.forecastComplete).toBe(false);
  });

  it("is true when the plan reaches the horizon's end (regression: existing behaviour)", () => {
    expect(requiredCollection(2050).forecastComplete).toBe(true);
    expect(requiredCollection(2050).forecastIncompleteReasons).toEqual([]);
    expect(fundingNeed(2050).signal.forecastComplete).toBe(true);
  });

  it("is false when no coverage year has been set at all", () => {
    // THE TRAP THIS TEST EXISTS FOR. projectCashPath treats an unset coverage
    // year as "every year is covered": beyondCoverage is absent and every row
    // reports costsKnown: true, exactly as for a plan that genuinely reaches
    // 2050. A completeness check written against the cash path's shape would
    // therefore call an undeclared plan complete — silently choosing the
    // option that was explicitly rejected, because "I never said how far the
    // plan reaches" must not read to the user as "all is well".
    const { cashPath, signal } = fundingNeed(undefined);

    expect(cashPath.beyondCoverage).toBeUndefined();
    expect(cashPath.years.every((year) => year.costsKnown)).toBe(true);
    expect(signal.forecastComplete).toBe(false);
    expect(signal.forecastIncompleteReasons).toEqual(["coverage_unset"]);
    expect(requiredCollection(undefined).forecastComplete).toBe(false);
  });

  it("keeps the flag and the reasons in agreement in every case", () => {
    for (const coverage of [undefined, 2030, 2050]) {
      for (const result of [requiredCollection(coverage), fundingNeed(coverage).signal]) {
        expect(result.forecastComplete).toBe(result.forecastIncompleteReasons.length === 0);
      }
    }
  });

  it("changes only the completeness claim, not the arithmetic", () => {
    // The known-cost lower bound deliberately keeps reading the whole horizon
    // from the projection: coverage changes what may be claimed, not what is
    // known. Same for the buffer signal's amounts.
    const covered = requiredCollection(2050);
    const short = requiredCollection(2030);

    expect(short.knownCostRequiredAnnualCollection)
      .toBe(covered.knownCostRequiredAnnualCollection);
    expect(short.additionalAnnualCollection).toBe(covered.additionalAnnualCollection);
    expect(short.planningYearCount).toBe(covered.planningYearCount);
  });
});
