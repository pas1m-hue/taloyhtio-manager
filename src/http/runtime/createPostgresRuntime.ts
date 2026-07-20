import type { PoolConfig } from "pg";
import type { AuthenticationPort } from "../../auth/authenticationPort.js";
import { loadPostgresMigrations, runPostgresMigrations } from "../../database/migrationRunner.js";
import { PostgresCompanyAccessRepository } from "../../database/postgresCompanyAccessRepository.js";
import { PostgresPublishingRepository } from "../../database/postgresPublishingRepository.js";
import { PostgresSessionWorkspaceRepository } from "../../database/postgresSessionRepository.js";
import { NodePostgresPool } from "../../database/sql.js";
import type { ServerClock } from "../clock.js";
import type { TaloyhtioHttpServer } from "../createHttpServer.js";
import { createApplicationHttpRuntime } from "./createRuntime.js";

export interface PostgresHttpRuntime {
  readonly server: TaloyhtioHttpServer;
  readonly pool: NodePostgresPool;
  close(): Promise<void>;
}

/**
 * Production composition root. Authentication remains provider-agnostic;
 * the caller supplies the verified credential adapter.
 */
export async function createPostgresHttpRuntime(
  authentication: AuthenticationPort<string>,
  database: PoolConfig,
  options: {
    readonly clock?: ServerClock;
    readonly publicDirectory?: string;
    readonly logger?: boolean;
    readonly sessionTtlMs?: number;
  } = {},
): Promise<PostgresHttpRuntime> {
  const pool = new NodePostgresPool(database);
  try {
    await runPostgresMigrations(pool, await loadPostgresMigrations());
    const publications = new PostgresPublishingRepository(pool);
    const sessions = new PostgresSessionWorkspaceRepository(pool);
    const access = new PostgresCompanyAccessRepository(pool);
    const server = createApplicationHttpRuntime(
      authentication,
      { publications, sessions, access },
      options,
    );
    return {
      server,
      pool,
      close: async () => {
        await server.close();
        await pool.end();
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
