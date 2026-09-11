import type {
  CompletedWorksDocument,
  MaintenanceNeedStatement,
  TechnicalLifespanDocument,
} from "../domain/types.js";

/**
 * A few rows of each Selvitykset document (handoff feature/selvitykset §8).
 * The real contents are pasted into the app in the live test; these only
 * have to exercise the shapes - a year that repeats, a timing that is
 * absent, and a lifespan list whose order is by subject rather than
 * alphabet, so a test can notice if something resorts it.
 */
export const completedWorksFixture: CompletedWorksDocument = {
  id: "completed_works",
  kind: "completed_works",
  sourceIds: ["tehdyt_toimenpiteet"],
  rows: [
    { year: 2025, description: "IV-putkien eristys B4" },
    { year: 2012, description: "Vesikaton uusiminen" },
    { year: 2025, description: "Sähköpääkeskuksen uusiminen" },
    { year: 2019, description: "Ikkunoiden huoltomaalaus" },
  ],
};

export const maintenanceNeedFixture: MaintenanceNeedStatement = {
  id: "maintenance_need",
  kind: "maintenance_need",
  sourceIds: ["kunnossapitotarveselvitys_2026_2030"],
  period: { startYear: 2026, endYear: 2030 },
  boardHandledAt: "2026-03-10",
  rows: [
    { measure: "Ilmanvaihdon puhdistus", targetTiming: "kevät 2026" },
    { measure: "Julkisivujen huoltomaalaus" },
    { measure: "Lämminvesivaraajien uusiminen" },
  ],
};

export const technicalLifespanFixture: TechnicalLifespanDocument = {
  id: "technical_lifespan",
  kind: "technical_lifespan",
  sourceIds: ["tekninen_kayttoika"],
  rows: [
    { item: "Vesikatto, tiili", interval: "30–50 v" },
    { item: "Viemärit", interval: "50 v – rakennuksen ikä" },
    { item: "Ikkunat", interval: "yli 50 v" },
    { item: "Lämminvesivaraaja", interval: "15–25 v" },
  ],
};
