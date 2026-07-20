import path from "node:path";
import { fileURLToPath } from "node:url";
import { RemoteJwksProvider, type JwksKeyProvider } from "../../auth/jwksClient.js";
import { SupabaseJwtAuthenticationPort } from "../../auth/supabaseJwtAuthentication.js";
import {
  createProductionPoolConfig,
  type ProductionEnvironment,
} from "../../config/environment.js";
import type { ServerClock } from "../clock.js";
import {
  createPostgresHttpRuntime,
  type PostgresHttpRuntime,
} from "./createPostgresRuntime.js";

export interface ProductionRuntimeOptions {
  readonly clock?: ServerClock;
  readonly logger?: boolean;
  readonly publicDirectory?: string;
  readonly keyProvider?: JwksKeyProvider;
}

export function createProductionAuthentication(
  config: ProductionEnvironment,
  keyProvider: JwksKeyProvider = new RemoteJwksProvider({
    jwksUrl: config.supabaseJwksUrl,
    cacheTtlMs: config.jwksCacheTtlSeconds * 1000,
  }),
): SupabaseJwtAuthenticationPort {
  return new SupabaseJwtAuthenticationPort({
    issuer: config.supabaseJwtIssuer,
    audience: config.supabaseJwtAudience,
    keyProvider,
  });
}

/** Hosted composition root. No local bearer-token adapter is reachable here. */
export async function createProductionRuntime(
  config: ProductionEnvironment,
  options: ProductionRuntimeOptions = {},
): Promise<PostgresHttpRuntime> {
  const authentication = createProductionAuthentication(
    config,
    options.keyProvider,
  );
  const publicDirectory = options.publicDirectory ?? path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../public",
  );
  return createPostgresHttpRuntime(
    authentication,
    createProductionPoolConfig(config),
    {
      publicDirectory,
      logger: options.logger ?? true,
      sessionTtlMs: config.visitorSessionTtlSeconds * 1000,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    },
  );
}
