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
    if (url.pathname === "/api/v1/auth-debug") return authDebug(request, env);

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


async function authDebug(request: Request, env: CloudflareEnv): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerPrefix = "Bearer ";
  const token = authorization.startsWith(bearerPrefix)
    ? authorization.slice(bearerPrefix.length)
    : "";
  const parts = token.split(".");
  const result: Record<string, unknown> = {
    authorizationHeaderPresent: authorization.length > 0,
    bearerTokenPresent: token.length > 0,
    jwtPartCount: parts.length,
    envIssuerPresent: env.SUPABASE_JWT_ISSUER.length > 0,
    envAudience: env.SUPABASE_JWT_AUDIENCE,
    envJwksUrlPresent: env.SUPABASE_JWKS_URL.length > 0,
  };

  try {
    if (parts.length !== 3) {
      return debugResponse({ ...result, stage: "token_parts" });
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = parseDebugJson(encodedHeader) as Record<string, unknown>;
    const claims = parseDebugJson(encodedPayload) as Record<string, unknown>;

    result.alg = header.alg;
    result.kidPresent = typeof header.kid === "string" && header.kid.length > 0;
    result.issuerMatches = claims.iss === env.SUPABASE_JWT_ISSUER;
    result.audienceMatches = claims.aud === env.SUPABASE_JWT_AUDIENCE ||
      (Array.isArray(claims.aud) && claims.aud.includes(env.SUPABASE_JWT_AUDIENCE));
    result.roleAuthenticated = claims.role === "authenticated";
    result.anonymousFalse = claims.is_anonymous !== true;
    result.sessionIdPresent = typeof claims.session_id === "string" && claims.session_id.length > 0;
    result.aalAccepted = claims.aal === "aal1" || claims.aal === "aal2";

    const nowSeconds = Math.floor(Date.now() / 1000);
    result.expValid = typeof claims.exp === "number" && claims.exp > nowSeconds - 30;
    result.iatValid = typeof claims.iat === "number" && claims.iat <= nowSeconds + 30;
    result.nbfValid = claims.nbf === undefined ||
      (typeof claims.nbf === "number" && claims.nbf <= nowSeconds + 30);

    const jwksResponse = await fetch(env.SUPABASE_JWKS_URL, {
      headers: { accept: "application/json" },
    });
    result.jwksStatus = jwksResponse.status;

    const jwks = await jwksResponse.json() as { keys?: Array<Record<string, unknown>> };
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    const jwk = keys.find((key) => key.kid === header.kid && key.alg === header.alg);
    result.jwksKeyCount = keys.length;
    result.matchingKid = Boolean(jwk);
    result.matchingKeyType = jwk?.kty;
    result.matchingKeyAlgorithm = jwk?.alg;

    if (jwk === undefined || typeof header.alg !== "string") {
      return debugResponse({ ...result, stage: "jwk_match" });
    }

    const signatureVerified = await verifyDebugSignature(
      header.alg,
      jwk,
      `${encodedHeader}.${encodedPayload}`,
      encodedSignature,
    );
    result.signatureVerified = signatureVerified;

    result.claimsWouldPass = result.issuerMatches === true &&
      result.audienceMatches === true &&
      result.roleAuthenticated === true &&
      result.anonymousFalse === true &&
      result.sessionIdPresent === true &&
      result.aalAccepted === true &&
      result.expValid === true &&
      result.iatValid === true &&
      result.nbfValid === true;

    return debugResponse({ ...result, stage: "complete" });
  } catch (error) {
    return debugResponse({
      ...result,
      stage: "exception",
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : "unknown",
    });
  }
}

function debugResponse(body: Record<string, unknown>): Response {
  return Response.json(body, {
    headers: { "cache-control": "no-store" },
  });
}

async function verifyDebugSignature(
  algorithm: string,
  jwk: Record<string, unknown>,
  signingInput: string,
  encodedSignature: string,
): Promise<boolean> {
  const signature = decodeDebugBase64Url(encodedSignature);
  const input = new TextEncoder().encode(signingInput);
  if (algorithm === "ES256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      input,
    );
  }
  if (algorithm === "RS256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, input);
  }
  return false;
}

function parseDebugJson(encoded: string): unknown {
  return JSON.parse(new TextDecoder().decode(decodeDebugBase64Url(encoded))) as unknown;
}

function decodeDebugBase64Url(value: string): Uint8Array {
  if (value === "" || value.includes("=") || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Invalid base64url segment.");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
