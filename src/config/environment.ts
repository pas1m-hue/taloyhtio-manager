import type { PoolConfig } from "pg";

export const DEFAULT_PRODUCTION_PORT = 3000;
export const DEFAULT_VISITOR_SESSION_TTL_SECONDS = 24 * 60 * 60;
export const MAX_VISITOR_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_JWKS_CACHE_TTL_SECONDS = 10 * 60;

export interface ProductionEnvironment {
  readonly environment: "production";
  readonly host: string;
  readonly port: number;
  readonly publicAppUrl: string;
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly databaseConnectionTimeoutMs: number;
  readonly visitorSessionTtlSeconds: number;
  readonly supabaseUrl: string;
  readonly supabaseJwtIssuer: string;
  readonly supabaseJwtAudience: string;
  readonly supabaseJwksUrl: string;
  readonly jwksCacheTtlSeconds: number;
}

export interface ProductionDatabaseEnvironment {
  readonly environment: "production";
  readonly databaseUrl: string;
  readonly databasePoolMax: number;
  readonly databaseConnectionTimeoutMs: number;
}

export class EnvironmentValidationError extends Error {
  public readonly code = "INVALID_PRODUCTION_ENVIRONMENT";

  public constructor(message: string) {
    super(message);
    this.name = "EnvironmentValidationError";
  }
}

export function loadProductionEnvironment(
  env: NodeJS.ProcessEnv,
): ProductionEnvironment {
  assertProductionMode(env);
  rejectDevelopmentAuthentication(env);

  const supabaseUrl = requireHttpsUrl(env.SUPABASE_URL, "SUPABASE_URL");
  const expectedIssuer = `${withoutTrailingSlash(supabaseUrl)}/auth/v1`;
  const configuredIssuer = env.SUPABASE_JWT_ISSUER?.trim();
  const supabaseJwtIssuer = configuredIssuer === undefined || configuredIssuer === ""
    ? expectedIssuer
    : requireHttpsUrl(configuredIssuer, "SUPABASE_JWT_ISSUER");
  if (withoutTrailingSlash(supabaseJwtIssuer) !== expectedIssuer) {
    throw new EnvironmentValidationError(
      "SUPABASE_JWT_ISSUER must match SUPABASE_URL + /auth/v1.",
    );
  }

  const supabaseJwtAudience = optionalNonEmpty(
    env.SUPABASE_JWT_AUDIENCE,
    "authenticated",
    "SUPABASE_JWT_AUDIENCE",
  );
  if (supabaseJwtAudience !== "authenticated") {
    throw new EnvironmentValidationError(
      "SUPABASE_JWT_AUDIENCE must be authenticated for admin user tokens.",
    );
  }

  const database = loadProductionDatabaseEnvironment(env);
  const publicAppUrl = requireHttpsUrl(env.PUBLIC_APP_URL, "PUBLIC_APP_URL");
  const publicUrl = new URL(publicAppUrl);
  if (publicUrl.username !== "" || publicUrl.password !== "" ||
      publicUrl.search !== "" || publicUrl.hash !== "") {
    throw new EnvironmentValidationError(
      "PUBLIC_APP_URL must not contain credentials, a query or a fragment.",
    );
  }

  return {
    environment: "production",
    host: optionalNonEmpty(env.TM_HOST, "0.0.0.0", "TM_HOST"),
    port: integerInRange(env.PORT ?? env.TM_PORT, DEFAULT_PRODUCTION_PORT, 1, 65_535, "PORT"),
    publicAppUrl: withoutTrailingSlash(publicAppUrl),
    databaseUrl: database.databaseUrl,
    databasePoolMax: database.databasePoolMax,
    databaseConnectionTimeoutMs: database.databaseConnectionTimeoutMs,
    visitorSessionTtlSeconds: integerInRange(
      env.SESSION_TTL_SECONDS,
      DEFAULT_VISITOR_SESSION_TTL_SECONDS,
      300,
      MAX_VISITOR_SESSION_TTL_SECONDS,
      "SESSION_TTL_SECONDS",
    ),
    supabaseUrl: withoutTrailingSlash(supabaseUrl),
    supabaseJwtIssuer: withoutTrailingSlash(supabaseJwtIssuer),
    supabaseJwtAudience,
    supabaseJwksUrl: `${withoutTrailingSlash(supabaseJwtIssuer)}/.well-known/jwks.json`,
    jwksCacheTtlSeconds: integerInRange(
      env.JWKS_CACHE_TTL_SECONDS,
      DEFAULT_JWKS_CACHE_TTL_SECONDS,
      60,
      60 * 60,
      "JWKS_CACHE_TTL_SECONDS",
    ),
  };
}

export function loadProductionDatabaseEnvironment(
  env: NodeJS.ProcessEnv,
): ProductionDatabaseEnvironment {
  assertProductionMode(env);
  rejectDevelopmentAuthentication(env);
  const databaseUrl = requireDatabaseUrl(env.DATABASE_URL);
  return {
    environment: "production",
    databaseUrl,
    databasePoolMax: integerInRange(
      env.DATABASE_POOL_MAX,
      5,
      1,
      50,
      "DATABASE_POOL_MAX",
    ),
    databaseConnectionTimeoutMs: integerInRange(
      env.DATABASE_CONNECTION_TIMEOUT_MS,
      10_000,
      1_000,
      60_000,
      "DATABASE_CONNECTION_TIMEOUT_MS",
    ),
  };
}

export function createProductionPoolConfig(
  config: ProductionDatabaseEnvironment,
): PoolConfig {
  return {
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: false,
  };
}

function assertProductionMode(env: NodeJS.ProcessEnv): void {
  if (env.TM_ENV !== "production" ||
      (env.NODE_ENV !== undefined && env.NODE_ENV !== "production")) {
    throw new EnvironmentValidationError(
      "TM_ENV must be production and NODE_ENV, when set, must also be production.",
    );
  }
}

function rejectDevelopmentAuthentication(env: NodeJS.ProcessEnv): void {
  const forbidden = [
    "TM_DEV_ADMIN_TOKEN",
    "TM_STATIC_ADMIN_TOKEN",
    "LOCAL_ADMIN_TOKEN",
  ] as const;
  for (const key of forbidden) {
    if (env[key]?.trim()) {
      throw new EnvironmentValidationError(
        `${key} is forbidden in production configuration.`,
      );
    }
  }
}

function requireDatabaseUrl(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new EnvironmentValidationError("DATABASE_URL is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EnvironmentValidationError("DATABASE_URL must be a valid URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new EnvironmentValidationError(
      "DATABASE_URL must use postgres: or postgresql:.",
    );
  }
  if (parsed.hostname.trim() === "" || parsed.pathname === "" || parsed.pathname === "/") {
    throw new EnvironmentValidationError(
      "DATABASE_URL must include a host and database name.",
    );
  }
  if (parsed.username.trim() === "" || parsed.password === "") {
    throw new EnvironmentValidationError(
      "DATABASE_URL must include a database username and password.",
    );
  }
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode !== null && sslMode !== "verify-full") {
    throw new EnvironmentValidationError(
      "DATABASE_URL sslmode must be verify-full in production.",
    );
  }
  parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}

function requireHttpsUrl(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") {
    throw new EnvironmentValidationError(`${name} is required.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EnvironmentValidationError(`${name} must be a valid URL.`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname.trim() === "") {
    throw new EnvironmentValidationError(`${name} must use HTTPS.`);
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new EnvironmentValidationError(`${name} must not contain credentials.`);
  }
  return parsed.toString();
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function optionalNonEmpty(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new EnvironmentValidationError(`${name} must not be empty.`);
  }
  return trimmed;
}

function integerInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new EnvironmentValidationError(`${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new EnvironmentValidationError(
      `${name} must be between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}
