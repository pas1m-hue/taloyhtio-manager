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
