import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SecuredAdminApplicationFacade } from "../application/securedAdminFacade.js";
import type { PublicVisitorApplicationFacade } from "../application/publicVisitorFacade.js";
import { SystemServerClock, type ServerClock } from "./clock.js";
import { mapHttpError, type HttpErrorPayload, HttpRequestValidationError } from "./httpErrors.js";
import {
  assertNoTrustedMetadata,
  ensureObject,
  parseAdminCredential,
  parseHorizon,
  parseVisitorToken,
  type AdminChangesBody,
  type AdminPublishBody,
  type CreateSessionBody,
  type HorizonQuery,
  type VisitorChangesBody,
  type VisitorResetBody,
} from "./requestParsing.js";
import { SECURITY_HEADERS } from "./securityHeaders.js";

const BODY_LIMIT = 1_000_000;

export interface HttpServerDependencies {
  readonly admin: SecuredAdminApplicationFacade<string>;
  readonly visitor: PublicVisitorApplicationFacade;
  readonly clock?: ServerClock;
  readonly publicDirectory?: string;
  readonly logger?: boolean;
}

export interface ListenOptions {
  readonly host?: string;
  readonly port: number;
}

export interface InjectOptions {
  readonly method?: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly payload?: unknown;
}

export interface InjectResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  json<T = unknown>(): T;
}

interface InternalRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: unknown;
  readonly requestId: string;
}

interface InternalResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Buffer;
}

export class TaloyhtioHttpServer {
  readonly #dependencies: HttpServerDependencies;
  readonly #clock: ServerClock;
  readonly #publicDirectory: string;
  #server: Server | undefined;

  public constructor(dependencies: HttpServerDependencies) {
    this.#dependencies = dependencies;
    this.#clock = dependencies.clock ?? new SystemServerClock();
    this.#publicDirectory = dependencies.publicDirectory ?? path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../public",
    );
  }

  public async listen(options: ListenOptions): Promise<string> {
    if (this.#server !== undefined) {
      throw new Error("HTTP server is already listening.");
    }
    const server = createServer((request, response) => {
      void this.#handleNodeRequest(request, response);
    });
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, options.host ?? "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("HTTP server address is unavailable.");
    }
    return `http://${address.address}:${address.port}`;
  }

  public async close(): Promise<void> {
    const server = this.#server;
    if (server === undefined) return;
    this.#server = undefined;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    });
  }

  public async inject(options: InjectOptions): Promise<InjectResponse> {
    const headers = Object.fromEntries(
      Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const response = await this.#dispatch({
      method: (options.method ?? "GET").toUpperCase(),
      url: new URL(options.url, "http://localhost"),
      headers,
      ...(options.payload === undefined ? {} : { body: structuredClone(options.payload) }),
      requestId: headers["x-request-id"] ?? randomUUID(),
    });
    const body = Buffer.isBuffer(response.body)
      ? response.body.toString("utf8")
      : response.body;
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body,
      json: <T>() => JSON.parse(body) as T,
    };
  }

  async #handleNodeRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const headers = normalizeHeaders(request);
    const requestId = headers["x-request-id"] ?? randomUUID();
    try {
      const body = await readRequestBody(request);
      const result = await this.#dispatch({
        method: (request.method ?? "GET").toUpperCase(),
        url: new URL(request.url ?? "/", `http://${headers.host ?? "localhost"}`),
        headers,
        ...(body === undefined ? {} : { body }),
        requestId,
      });
      sendNodeResponse(response, result);
    } catch (error) {
      const pathname = (() => {
        try {
          return new URL(request.url ?? "/", "http://localhost").pathname;
        } catch {
          return "/api/";
        }
      })();
      const result = withCommonHeaders(
        errorResponse(error, requestId, true, this.#dependencies.logger ?? false),
        pathname.startsWith("/api/"),
      );
      sendNodeResponse(response, result);
    }
  }

  async #dispatch(request: InternalRequest): Promise<InternalResponse> {
    try {
      const route = await this.#route(request);
      return withCommonHeaders(route, request.url.pathname.startsWith("/api/"));
    } catch (error) {
      return withCommonHeaders(
        errorResponse(error, request.requestId, false, this.#dependencies.logger ?? false),
        request.url.pathname.startsWith("/api/"),
      );
    }
  }

  async #route(request: InternalRequest): Promise<InternalResponse> {
    if (request.method === "GET" && request.url.pathname === "/api/v1/health") {
      return jsonResponse(200, {
        status: "ok",
        service: "taloyhtio-manager",
        apiVersion: "v1",
      });
    }

    const adminWorkspace = matchPath(
      request.url.pathname,
      /^\/api\/v1\/admin\/companies\/([^/]+)\/(workspace|preview|publications)$/,
    );
    if (request.method === "GET" && adminWorkspace !== undefined) {
      const companyId = requiredSegment(adminWorkspace, 0);
      const action = requiredSegment(adminWorkspace, 1);
      const credential = parseAdminCredential(request.headers.authorization);
      if (action === "publications") {
        return jsonResponse(200, await this.#dependencies.admin.loadPublicationHistory(
          credential,
          companyId,
          this.#clock.now(),
        ));
      }
      const horizon = parseHorizon(queryObject(request.url));
      const result = action === "workspace"
        ? await this.#dependencies.admin.loadWorkspace(
            credential,
            companyId,
            horizon,
            this.#clock.now(),
          )
        : await this.#dependencies.admin.previewCalculations(
            credential,
            companyId,
            horizon,
            this.#clock.now(),
          );
      return jsonResponse(200, result);
    }

    const adminChange = matchPath(
      request.url.pathname,
      /^\/api\/v1\/admin\/companies\/([^/]+)\/(changes|publish)$/,
    );
    if (request.method === "POST" && adminChange !== undefined) {
      const companyId = requiredSegment(adminChange, 0);
      const action = requiredSegment(adminChange, 1);
      const credential = parseAdminCredential(request.headers.authorization);
      assertNoTrustedMetadata(request.body);
      if (action === "changes") {
        const body = ensureAdminChangesBody(request.body);
        return jsonResponse(200, await this.#dependencies.admin.applyChanges(
          credential,
          {
            companyId,
            expectedRevision: body.expectedRevision,
            operations: body.operations,
          },
          body.horizon,
          this.#clock.now(),
        ));
      }
      const body = ensureAdminPublishBody(request.body);
      return jsonResponse(200, await this.#dependencies.admin.publish(
        credential,
        { companyId, ...body },
        this.#clock.now(),
      ));
    }

    const publicOverview = matchPath(
      request.url.pathname,
      /^\/api\/v1\/public\/companies\/([^/]+)\/overview$/,
    );
    if (request.method === "GET" && publicOverview !== undefined) {
      return jsonResponse(200, await this.#dependencies.visitor.loadPublishedOverview(
        requiredSegment(publicOverview, 0),
        parseHorizon(queryObject(request.url)),
      ));
    }

    const createSession = matchPath(
      request.url.pathname,
      /^\/api\/v1\/public\/companies\/([^/]+)\/sessions$/,
    );
    if (request.method === "POST" && createSession !== undefined) {
      assertNoTrustedMetadata(request.body);
      const body = ensureCreateSessionBody(request.body);
      return jsonResponse(201, await this.#dependencies.visitor.createSession(
        {
          companyId: requiredSegment(createSession, 0),
          publicationVersion: body.publicationVersion,
          horizon: body.horizon,
        },
        this.#clock.now(),
      ));
    }

    const sessionRoute = matchPath(
      request.url.pathname,
      /^\/api\/v1\/public\/sessions\/([^/]+)(?:\/(reset))?$/,
    );
    if (sessionRoute !== undefined) {
      const sessionId = requiredSegment(sessionRoute, 0);
      const suffix = sessionRoute[1] ?? "";
      const accessToken = parseVisitorToken(request.headers["x-tm-session-token"]);
      if (request.method === "GET" && suffix === "") {
        return jsonResponse(200, await this.#dependencies.visitor.loadScenario(
          { sessionId, accessToken },
          this.#clock.now(),
        ));
      }
      assertNoTrustedMetadata(request.body);
      if (request.method === "PATCH" && suffix === "") {
        const body = ensureVisitorChangesBody(request.body);
        return jsonResponse(200, await this.#dependencies.visitor.applyChanges(
          {
            sessionId,
            accessToken,
            expectedRevision: body.expectedRevision,
            operations: body.operations,
          },
          this.#clock.now(),
        ));
      }
      if (request.method === "POST" && suffix === "reset") {
        const body = ensureVisitorResetBody(request.body);
        return jsonResponse(200, await this.#dependencies.visitor.reset(
          { sessionId, accessToken, expectedRevision: body.expectedRevision },
          this.#clock.now(),
        ));
      }
    }

    const staticAsset = staticAssetFor(request.method, request.url.pathname);
    if (staticAsset !== undefined) {
      return {
        statusCode: 200,
        headers: {
          "content-type": staticAsset.contentType,
          "cache-control": staticAsset.file === "index.html"
            ? "no-cache"
            : "public, max-age=300",
        },
        body: await readFile(path.join(this.#publicDirectory, staticAsset.file)),
      };
    }

    return jsonResponse(404, {
      error: {
        code: "HTTP_ROUTE_NOT_FOUND",
        message: "HTTP route does not exist.",
        requestId: request.requestId,
      },
    });
  }
}

export function createHttpServer(
  dependencies: HttpServerDependencies,
): TaloyhtioHttpServer {
  return new TaloyhtioHttpServer(dependencies);
}

function ensureAdminChangesBody(value: unknown): AdminChangesBody {
  const body = ensureObject<Partial<AdminChangesBody>>(value, "Admin changes body");
  assertExactKeys(body, ["expectedRevision", "horizon", "operations"]);
  if (!nonNegativeInteger(body.expectedRevision) || !Array.isArray(body.operations) ||
      body.operations.length === 0) {
    throw invalidRequest("Admin changes body is invalid.");
  }
  const horizon = ensureHorizon(body.horizon);
  return { expectedRevision: body.expectedRevision, horizon, operations: body.operations };
}

function ensureAdminPublishBody(value: unknown): AdminPublishBody {
  const body = ensureObject<Partial<AdminPublishBody>>(value, "Publish body");
  assertExactKeys(body, [
    "expectedAdminRevision",
    "expectedPublishedVersion",
    "sourceIds",
    "explanation",
  ]);
  if (!nonNegativeInteger(body.expectedAdminRevision) ||
      !nonNegativeInteger(body.expectedPublishedVersion) ||
      !nonEmptyStrings(body.sourceIds) || !nonEmptyString(body.explanation)) {
    throw invalidRequest("Publish body is invalid.");
  }
  return body as AdminPublishBody;
}

function ensureCreateSessionBody(value: unknown): CreateSessionBody {
  const body = ensureObject<Partial<CreateSessionBody>>(value, "Create session body");
  assertExactKeys(body, ["publicationVersion", "horizon"]);
  if (!positiveInteger(body.publicationVersion)) {
    throw invalidRequest("Publication version must be a positive integer.");
  }
  return {
    publicationVersion: body.publicationVersion,
    horizon: ensureHorizon(body.horizon),
  };
}

function ensureVisitorChangesBody(value: unknown): VisitorChangesBody {
  const body = ensureObject<Partial<VisitorChangesBody>>(value, "Visitor changes body");
  assertExactKeys(body, ["expectedRevision", "operations"]);
  if (!nonNegativeInteger(body.expectedRevision) || !Array.isArray(body.operations) ||
      body.operations.length === 0) {
    throw invalidRequest("Visitor changes body is invalid.");
  }
  return { expectedRevision: body.expectedRevision, operations: body.operations };
}

function ensureVisitorResetBody(value: unknown): VisitorResetBody {
  const body = ensureObject<Partial<VisitorResetBody>>(value, "Visitor reset body");
  assertExactKeys(body, ["expectedRevision"]);
  if (!nonNegativeInteger(body.expectedRevision)) {
    throw invalidRequest("Visitor reset body is invalid.");
  }
  return { expectedRevision: body.expectedRevision };
}

function ensureHorizon(value: unknown): { readonly startYear: number; readonly endYear: number } {
  const candidate = ensureObject<HorizonQuery>(value, "Horizon");
  assertExactKeys(candidate as unknown as Readonly<Record<string, unknown>>, ["startYear", "endYear"]);
  return parseHorizon(candidate);
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedSet.has(key)) ||
      allowed.some((key) => !(key in value))) {
    throw invalidRequest("Request contains missing or unsupported fields.");
  }
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
function nonEmptyStrings(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}
function invalidRequest(message: string): HttpRequestValidationError {
  return new HttpRequestValidationError(message);
}

function queryObject(url: URL): HorizonQuery {
  const allowed = new Set(["startYear", "endYear"]);
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => url.searchParams.getAll(key).length > 1)) {
    throw invalidRequest("Query contains unsupported or duplicate fields.");
  }
  const result: { startYear?: string; endYear?: string } = {};
  const startYear = url.searchParams.get("startYear");
  const endYear = url.searchParams.get("endYear");
  if (startYear !== null) result.startYear = startYear;
  if (endYear !== null) result.endYear = endYear;
  return result;
}

function requiredSegment(values: readonly string[], index: number): string {
  const value = values[index];
  if (value === undefined || value === "") {
    throw invalidRequest("Route parameter is missing.");
  }
  return value;
}

function matchPath(pathname: string, pattern: RegExp): readonly string[] | undefined {
  const match = pattern.exec(pathname);
  if (match === null) return undefined;
  try {
    return match.slice(1).map((value) => decodeURIComponent(value ?? ""));
  } catch {
    throw invalidRequest("Route parameter encoding is invalid.");
  }
}

function staticAssetFor(
  method: string,
  pathname: string,
): { readonly file: string; readonly contentType: string } | undefined {
  if (method !== "GET") return undefined;
  switch (pathname) {
    case "/":
    case "/index.html":
      return { file: "index.html", contentType: "text/html; charset=utf-8" };
    case "/app.js":
      return { file: "app.js", contentType: "text/javascript; charset=utf-8" };
    case "/styles.css":
      return { file: "styles.css", contentType: "text/css; charset=utf-8" };
    default:
      return undefined;
  }
}

function jsonResponse(statusCode: number, body: unknown): InternalResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function errorResponse(
  error: unknown,
  requestId: string,
  parsingFailure: boolean,
  loggerEnabled: boolean,
): InternalResponse {
  const mapped = parsingFailure && !(error instanceof HttpRequestValidationError)
    ? { statusCode: 400, code: "INVALID_HTTP_REQUEST", message: "Request body is invalid." }
    : mapHttpError(error);
  if (loggerEnabled && mapped.statusCode >= 500) {
    console.error("Taloyhtio Manager HTTP error", error);
  }
  const payload: HttpErrorPayload = {
    error: { code: mapped.code, message: mapped.message, requestId },
  };
  return jsonResponse(mapped.statusCode, payload);
}

function withCommonHeaders(
  response: InternalResponse,
  apiRequest: boolean,
): InternalResponse {
  return {
    ...response,
    headers: {
      ...SECURITY_HEADERS,
      ...(apiRequest ? { "cache-control": "no-store" } : {}),
      ...response.headers,
    },
  };
}

function normalizeHeaders(request: IncomingMessage): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    result[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : value;
  }
  return result;
}

async function readRequestBody(request: IncomingMessage): Promise<unknown | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) {
      throw new HttpRequestValidationError("Request body exceeds 1 MB.");
    }
    chunks.push(buffer);
  }
  if (size === 0) return undefined;
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpRequestValidationError("Content-Type must be application/json.");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpRequestValidationError("Request body is not valid JSON.");
  }
}

function sendNodeResponse(response: ServerResponse, result: InternalResponse): void {
  response.statusCode = result.statusCode;
  for (const [key, value] of Object.entries(result.headers)) {
    response.setHeader(key, value);
  }
  response.end(result.body);
}
