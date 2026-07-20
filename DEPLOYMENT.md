# V2.8a deployment readiness

V2.8a prepares deployment but does not connect to a hosted Supabase project.

## Supported topology

```text
Browser
  -> HTTPS hosting / reverse proxy
  -> Node 22 Taloyhtiö Manager server
  -> TLS PostgreSQL connection

Admin bearer JWT
  -> local signature verification against Supabase JWKS

Visitor
  -> anonymous capability session
```

The same Node process serves the browser assets and `/api/v1` routes. No CORS configuration is required for the intended same-origin deployment.

## Build

```bash
npm ci --ignore-scripts
npm run verify
npm run build
```

## Configuration preflight

Copy `.env.production.example` to the hosting platform's secret/configuration system. Do not commit a real `.env` file.

```bash
npm run preflight:production
```

The preflight prints only non-secret metadata. It refuses startup when:

- production mode is not explicit
- a local/static admin token is present
- required URLs or database credentials are missing
- public/Supabase endpoints are not HTTPS
- the JWT issuer does not match the Supabase project
- the audience is not `authenticated`
- database TLS is weaker than `verify-full`
- numeric limits are invalid

## Migrations

```bash
npm run migrate:production
```

Run migrations as a release step before starting the new application version. The migration runner already uses advisory locking, checks SHA-256 migration integrity and rolls back failed runs.

## Start

```bash
npm run start:production
```

The server binds to `TM_HOST` / `PORT`. HTTPS termination belongs to the hosting platform or reverse proxy.

## Docker

```bash
docker build -t taloyhtio-manager:v2.8a .
docker run --rm -p 3000:3000 --env-file .env.production taloyhtio-manager:v2.8a
```

The runtime image contains production dependencies, compiled JavaScript and static browser assets. It runs as the non-root `node` user.

## What is not activated in V2.8a

- no hosted Supabase project
- no real admin login screen
- no email, magic-link or OAuth flow
- no hosted migration run
- no production company bootstrap
- no secret manager integration tied to one host
- no rate-limiter or observability vendor

The browser still accepts an access token field for development and adapter testing. V2.8b will replace manual token entry with the selected Supabase login flow.
