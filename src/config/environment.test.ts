import { describe, expect, it } from "vitest";
import {
  createProductionPoolConfig,
  EnvironmentValidationError,
  loadProductionDatabaseEnvironment,
  loadProductionEnvironment,
} from "./environment.js";

const BASE: NodeJS.ProcessEnv = {
  TM_ENV: "production",
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://tm_admin:secret@db.example.com:5432/tm",
  SUPABASE_URL: "https://project-ref.supabase.co",
  PUBLIC_APP_URL: "https://taloyhtio.example.com",
};

describe("production environment", () => {
  it("loads a strict production configuration and derives issuer/JWKS", () => {
    const config = loadProductionEnvironment(BASE);
    expect(config).toMatchObject({
      environment: "production",
      host: "0.0.0.0",
      port: 3000,
      publicAppUrl: "https://taloyhtio.example.com",
      supabaseUrl: "https://project-ref.supabase.co",
      supabaseJwtIssuer: "https://project-ref.supabase.co/auth/v1",
      supabaseJwtAudience: "authenticated",
      supabaseJwksUrl: "https://project-ref.supabase.co/auth/v1/.well-known/jwks.json",
      visitorSessionTtlSeconds: 86_400,
      jwksCacheTtlSeconds: 600,
    });
    expect(new URL(config.databaseUrl).searchParams.get("sslmode")).toBe("verify-full");
  });

  it("accepts bounded operational overrides", () => {
    const config = loadProductionEnvironment({
      ...BASE,
      PORT: "8080",
      TM_HOST: "127.0.0.1",
      SESSION_TTL_SECONDS: "3600",
      JWKS_CACHE_TTL_SECONDS: "120",
      DATABASE_POOL_MAX: "8",
      DATABASE_CONNECTION_TIMEOUT_MS: "15000",
    });
    expect(config).toMatchObject({
      port: 8080,
      host: "127.0.0.1",
      visitorSessionTtlSeconds: 3600,
      jwksCacheTtlSeconds: 120,
      databasePoolMax: 8,
      databaseConnectionTimeoutMs: 15_000,
    });
  });

  it("refuses to start outside explicit production mode", () => {
    expect(() => loadProductionEnvironment({ ...BASE, TM_ENV: "development" }))
      .toThrow(EnvironmentValidationError);
    expect(() => loadProductionEnvironment({ ...BASE, NODE_ENV: "test" }))
      .toThrow(/NODE_ENV/);
  });

  it("forbids local/static admin tokens in production", () => {
    expect(() => loadProductionEnvironment({
      ...BASE,
      TM_DEV_ADMIN_TOKEN: "local-development-admin-token",
    })).toThrow(/forbidden/);
    expect(() => loadProductionEnvironment({
      ...BASE,
      TM_STATIC_ADMIN_TOKEN: "A".repeat(32),
    })).toThrow(/forbidden/);
  });

  it("requires HTTPS for public and Supabase endpoints", () => {
    expect(() => loadProductionEnvironment({
      ...BASE,
      SUPABASE_URL: "http://project-ref.supabase.co",
    })).toThrow(/SUPABASE_URL must use HTTPS/);
    expect(() => loadProductionEnvironment({
      ...BASE,
      PUBLIC_APP_URL: "http://taloyhtio.example.com",
    })).toThrow(/PUBLIC_APP_URL must use HTTPS/);
  });

  it("rejects a cross-project issuer and non-user audience", () => {
    expect(() => loadProductionEnvironment({
      ...BASE,
      SUPABASE_JWT_ISSUER: "https://other.supabase.co/auth/v1",
    })).toThrow(/must match/);
    expect(() => loadProductionEnvironment({
      ...BASE,
      SUPABASE_JWT_AUDIENCE: "anon",
    })).toThrow(/authenticated/);
  });

  it("rejects unsafe or malformed database URLs", () => {
    expect(() => loadProductionDatabaseEnvironment({
      ...BASE,
      DATABASE_URL: "mysql://user:pass@db.example.com/tm",
    })).toThrow(/postgres/);
    expect(() => loadProductionDatabaseEnvironment({
      ...BASE,
      DATABASE_URL: "postgresql://db.example.com/tm",
    })).toThrow(/username and password/);
    expect(() => loadProductionDatabaseEnvironment({
      ...BASE,
      DATABASE_URL: "postgresql://user:pass@db.example.com/tm?sslmode=require",
    })).toThrow(/verify-full/);
  });

  it("rejects invalid ports, TTLs and cache durations", () => {
    expect(() => loadProductionEnvironment({ ...BASE, PORT: "0" }))
      .toThrow(/PORT/);
    expect(() => loadProductionEnvironment({ ...BASE, SESSION_TTL_SECONDS: "299" }))
      .toThrow(/SESSION_TTL_SECONDS/);
    expect(() => loadProductionEnvironment({ ...BASE, JWKS_CACHE_TTL_SECONDS: "59" }))
      .toThrow(/JWKS_CACHE_TTL_SECONDS/);
  });

  it("builds a bounded node-postgres pool configuration", () => {
    const database = loadProductionDatabaseEnvironment(BASE);
    expect(createProductionPoolConfig(database)).toEqual({
      connectionString: database.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      allowExitOnIdle: false,
    });
  });
});
