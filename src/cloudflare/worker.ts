import { PublicVisitorApplicationFacade } from "../application/publicVisitorFacade.js";
import { SecuredAdminApplicationFacade } from "../application/securedAdminFacade.js";
import { RemoteJwksProvider } from "../auth/jwksClient.js";
import { SupabaseJwtAuthenticationPort } from "../auth/supabaseJwtAuthentication.js";
import { PostgresCompanyAccessRepository } from "../database/postgresCompanyAccessRepository.js";
import { PostgresPublishingRepository } from "../database/postgresPublishingRepository.js";
import { PostgresSessionWorkspaceRepository } from "../database/postgresSessionRepository.js";
import { NodePostgresPool } from "../database/sql.js";
import { createHttpServer } from "../http/createHttpServer.js";

interface HyperdriveBinding { readonly connectionString: string }
interface AssetsBinding { fetch(request: Request): Promise<Response> }

export interface CloudflareEnv {
  readonly HYPERDRIVE: HyperdriveBinding;
  readonly ASSETS: AssetsBinding;
  readonly SUPABASE_JWT_ISSUER: string;
  readonly SUPABASE_JWT_AUDIENCE: string;
  readonly SUPABASE_JWKS_URL: string;
  readonly VISITOR_SESSION_TTL_SECONDS?: string;
}

const MAX_BODY_BYTES = 1_000_000;

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/api/v1/auth-debug-real") return authDebugReal(request, env);

    const pool = new NodePostgresPool({
      connectionString: required(env.HYPERDRIVE?.connectionString, "HYPERDRIVE"),
      max: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });

    try {
      const publications = new PostgresPublishingRepository(pool);
      const sessions = new PostgresSessionWorkspaceRepository(pool);
      const access = new PostgresCompanyAccessRepository(pool);
      const authentication = new SupabaseJwtAuthenticationPort({
        issuer: required(env.SUPABASE_JWT_ISSUER, "SUPABASE_JWT_ISSUER"),
        audience: required(env.SUPABASE_JWT_AUDIENCE, "SUPABASE_JWT_AUDIENCE"),
        keyProvider: new RemoteJwksProvider({
          jwksUrl: required(env.SUPABASE_JWKS_URL, "SUPABASE_JWKS_URL"),
        }),
      });
      const admin = new SecuredAdminApplicationFacade(authentication, access, publications);
      const visitor = new PublicVisitorApplicationFacade(
        publications,
        sessions,
        undefined,
        sessionTtlMs(env.VISITOR_SESSION_TTL_SECONDS),
      );
      const api = createHttpServer({ admin, visitor, logger: true, publicDirectory: "/" });
      const payload = await readPayload(request);
      const headers = Object.fromEntries(request.headers.entries());
      const result = await api.inject({
        method: request.method,
        url: `${url.pathname}${url.search}`,
        headers,
        ...(payload === undefined ? {} : { payload }),
      });
      return new Response(result.body, {
        status: result.statusCode,
        headers: result.headers,
      });
    } catch (error) {
      console.error("Cloudflare Worker request failed", error);
      return Response.json(
        { error: { code: "WORKER_RUNTIME_ERROR", message: "Request failed." } },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    } finally {
      await pool.end().catch(() => undefined);
    }
  },
};

async function readPayload(request: Request): Promise<unknown | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
    throw new Error("Request body exceeds the maximum size.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new Error("Request body exceeds the maximum size.");
  }
  if (text === "") return undefined;
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new Error("Request content type must be application/json.");
  }
  return JSON.parse(text) as unknown;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") throw new Error(`${name} is required.`);
  return value;
}

function sessionTtlMs(value: string | undefined): number {
  const seconds = value === undefined ? 86_400 : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 300 || seconds > 604_800) {
    throw new Error("VISITOR_SESSION_TTL_SECONDS is invalid.");
  }
  return seconds * 1_000;
}

async function authDebugReal(request: Request, env: CloudflareEnv): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerPrefix = "Bearer ";
  const token = authorization.startsWith(bearerPrefix)
    ? authorization.slice(bearerPrefix.length).trim()
    : "";
  const parts = token.split(".");
  const asOf = new Date().toISOString();
  const result: Record<string, unknown> = {
    authorizationHeaderPresent: authorization.length > 0,
    bearerTokenPresent: token.length > 0,
    credentialLength: token.length,
    jwtPartCount: token.length === 0 ? 0 : parts.length,
    asOf,
    asOfValid: validDate(asOf),
    envIssuerPresent: env.SUPABASE_JWT_ISSUER.length > 0,
    envAudiencePresent: env.SUPABASE_JWT_AUDIENCE.length > 0,
    envJwksUrlPresent: env.SUPABASE_JWKS_URL.length > 0,
  };

  try {
    const header = parts.length === 3 ? decodeDebugJson(parts[0] ?? "") : undefined;
    const kid = isRecord(header) && typeof header.kid === "string" ? header.kid : undefined;
    const algorithm = isRecord(header) && (header.alg === "ES256" || header.alg === "RS256")
      ? header.alg
      : undefined;
    result.alg = algorithm ?? null;
    result.kidPresent = typeof kid === "string" && kid.length > 0;

    const provider = new RemoteJwksProvider({
      jwksUrl: required(env.SUPABASE_JWKS_URL, "SUPABASE_JWKS_URL"),
    });

    if (kid !== undefined && algorithm !== undefined) {
      try {
        const key = await provider.getVerificationKey(kid, algorithm, asOf);
        result.remoteProviderKeyFound = key !== undefined;
        result.remoteProviderKeyType = key?.kty ?? null;
        result.remoteProviderKeyAlgorithm = key?.alg ?? null;
      } catch (error) {
        result.remoteProviderKeyFound = false;
        result.remoteProviderErrorName = error instanceof Error ? error.name : typeof error;
        result.remoteProviderErrorMessage = error instanceof Error ? error.message : String(error);
      }
    } else {
      result.remoteProviderKeyFound = false;
    }

    try {
      const authentication = new SupabaseJwtAuthenticationPort({
        issuer: required(env.SUPABASE_JWT_ISSUER, "SUPABASE_JWT_ISSUER"),
        audience: required(env.SUPABASE_JWT_AUDIENCE, "SUPABASE_JWT_AUDIENCE"),
        keyProvider: provider,
      });
      const identity = token.length === 0 ? undefined : await authentication.verify(token, asOf);
      result.authAdapterVerified = identity !== undefined;
      result.identitySubjectPresent = typeof identity?.subjectId === "string" && identity.subjectId.length > 0;
      result.identityExpiresAtPresent = typeof identity?.expiresAt === "string" && identity.expiresAt.length > 0;
      result.identityProvider = identity?.provider ?? null;

      if (identity !== undefined) {
        const companyId = new URL(request.url).searchParams.get("companyId") ?? "housing_company_demo";
        result.accessCompanyId = companyId;
        const pool = new NodePostgresPool({
          connectionString: required(env.HYPERDRIVE?.connectionString, "HYPERDRIVE"),
          max: 1,
          idleTimeoutMillis: 5_000,
          connectionTimeoutMillis: 10_000,
        });
        try {
          const access = new PostgresCompanyAccessRepository(pool);
          const grant = await access.load(companyId, identity.subjectId);
          result.accessGrantFound = grant !== undefined;
          result.accessGrantActive = grant?.active === true;
          result.accessGrantRevoked = grant?.revokedAt !== undefined;
          result.accessGrantRole = grant?.role ?? null;
        } catch (error) {
          result.accessGrantFound = false;
          result.accessErrorName = error instanceof Error ? error.name : typeof error;
          result.accessErrorMessage = error instanceof Error ? error.message : String(error);
        } finally {
          await pool.end().catch(() => undefined);
        }
      } else {
        result.accessGrantFound = false;
        result.accessGrantActive = false;
        result.accessGrantRevoked = null;
        result.accessGrantRole = null;
      }
    } catch (error) {
      result.authAdapterVerified = false;
      result.authAdapterErrorName = error instanceof Error ? error.name : typeof error;
      result.authAdapterErrorMessage = error instanceof Error ? error.message : String(error);
    }

    return debugJson(result);
  } catch (error) {
    return debugJson({
      ...result,
      debugErrorName: error instanceof Error ? error.name : typeof error,
      debugErrorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function debugJson(body: unknown): Response {
  return Response.json(body, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

function decodeDebugJson(encoded: string): unknown {
  const bytes = decodeDebugBase64Url(encoded);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function decodeDebugBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string): boolean {
  return value.trim() !== "" && Number.isFinite(Date.parse(value));
}
