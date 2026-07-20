import {
  createProductionPoolConfig,
  loadProductionDatabaseEnvironment,
} from "../config/environment.js";
import { loadPostgresMigrations, runPostgresMigrations } from "./migrationRunner.js";
import { NodePostgresPool } from "./sql.js";

async function main(): Promise<void> {
  const config = loadProductionDatabaseEnvironment(process.env);
  const pool = new NodePostgresPool(createProductionPoolConfig(config));
  try {
    const migrations = await loadPostgresMigrations();
    await runPostgresMigrations(pool, migrations);
    console.log(`Applied/verified ${migrations.length} Taloyhtio Manager migrations.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown migration error.";
  console.error(`Production migration failed: ${message}`);
  process.exitCode = 1;
});
