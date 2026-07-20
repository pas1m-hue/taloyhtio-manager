# Taloyhtiö Manager engine V2.8a

V2.8a makes the V2.7 HTTP/UI package production-ready **without requiring a Supabase account or hosted database during development**.

The application remains deterministic and non-AI:

```text
admin-maintained data
→ publication
→ visitor session overrides
→ scenario projection
→ cash path and repair-charge estimate
```

No document analysis, language-model API or automatic maintenance-cycle generation exists in the application.

## What V2.8a adds

- strict production environment validation
- asymmetric Supabase user-JWT verification (`ES256` and `RS256`)
- remote JWKS retrieval with bounded caching and key-rotation refresh
- issuer, audience, expiry, not-before, role and user-session claim checks
- hosted PostgreSQL production composition root
- production migration CLI
- safe production preflight CLI
- non-root multi-stage Dockerfile
- deployment and future Supabase setup instructions
- end-to-end test: signed Supabase-format JWT → HTTP admin route → company grant

## Authentication boundary

Admin requests send:

```http
Authorization: Bearer <supabase-user-access-token>
```

The server verifies the signature against:

```text
SUPABASE_URL/auth/v1/.well-known/jwks.json
```

The token must represent a normal authenticated user. `anon`, `service_role`, anonymous-user, expired, wrong-project and wrong-audience tokens are rejected. A valid token still needs an active row in `tm_company_access_grants` for the requested company.

V2.8a intentionally does not accept legacy `HS256` tokens. The later hosted project must use Supabase asymmetric signing keys.

Visitor access remains independent of Supabase Auth. Visitor sessions use server-generated capability tokens, and only their SHA-256 hashes are stored.

## Local development

```bash
npm ci --ignore-scripts
npm run dev
```

Open:

```text
http://127.0.0.1:3000
```

The local development server still uses an explicit development-only static token adapter. The browser no longer embeds the token as a default value; copy the token printed by the local server when needed.

Default demo values:

```text
company id: housing_company_demo
admin token: local-development-admin-token
```

The development adapter is unreachable from `createProductionRuntime`.

## Verification

```bash
npm run verify
npm run build
npm run test:production
```

Database tests use PGlite/PostgreSQL WASM. V2.8a does not make an external Supabase or hosted PostgreSQL connection.

## Production commands

After real environment variables have been configured:

```bash
npm ci --ignore-scripts
npm run build
npm run preflight:production
npm run migrate:production
npm run start:production
```

Configuration template:

```text
.env.production.example
```

The production runtime refuses to start when a local/static admin token is configured, URLs are insecure, database TLS is weaker than `verify-full`, or the Supabase issuer/audience does not match the expected project user-token configuration.

## Runtime structure

```text
src/config/
  environment.ts
  productionPreflight.ts

src/auth/
  jwksClient.ts
  supabaseJwtAuthentication.ts

src/http/runtime/
  createProductionRuntime.ts
  productionServer.ts

src/database/
  runProductionMigrations.ts
```

The existing domain, admin, publishing, visitor-session, projection and liquidity modules remain unchanged except for production composition and configurable visitor TTL wiring.

## Production dependencies

```text
pg
```

JWT verification uses Node 22's built-in cryptographic primitives. No Supabase SDK or JWT package is required in V2.8a.

## Environment variables

Required:

```text
TM_ENV=production
NODE_ENV=production
DATABASE_URL
SUPABASE_URL
PUBLIC_APP_URL
```

Optional bounded settings:

```text
TM_HOST
PORT
DATABASE_POOL_MAX
DATABASE_CONNECTION_TIMEOUT_MS
SUPABASE_JWT_ISSUER
SUPABASE_JWT_AUDIENCE
JWKS_CACHE_TTL_SECONDS
SESSION_TTL_SECONDS
```

See `.env.production.example` and `DEPLOYMENT.md` for exact constraints.

## Build-free browser UI

The browser interface remains plain HTML/CSS/JavaScript. It performs no financial calculations. All calculations and authorization decisions happen on the server.

The admin token field accepts:

- the printed static token in local development
- a real Supabase user JWT after V2.8b activation

V2.8a does not yet implement the sign-in form or token refresh flow.

## Documents

- `HTTP_API.md` — route and credential contract
- `DEPLOYMENT.md` — production build, preflight, migration and startup
- `SUPABASE_SETUP.md` — exact future account/project setup checklist
- `TEST_REPORT.md` — verified scope and test inventory
- `CLEAN_VERIFY_OUTPUT.txt` — clean ZIP verification output

## V2.8a boundaries

Not included yet:

- hosted Supabase project or account
- real Supabase browser login flow
- hosted database migration run
- production company bootstrap/import
- provider-specific secret manager
- rate limiting and external observability
- polished admin data-entry forms

The next hosted step is V2.8b: create the project, enable asymmetric signing, run migrations, configure the first company/admin grant and replace manual token entry with a real login flow.

# V2.8b Cloudflare Worker deployment

The production Cloudflare entry point is `src/cloudflare/worker.ts`.

Commands:

```bash
npm ci --ignore-scripts
npm run verify
npm run build:worker
npm run deploy:worker
```

Before deployment replace `REPLACE_WITH_TALOYHTIO_MANAGER_DB_HYPERDRIVE_ID` in `wrangler.jsonc` with the configuration ID shown for `taloyhtio-manager-db` in Cloudflare Hyperdrive. See `CLOUDFLARE_DEPLOY.md`.
