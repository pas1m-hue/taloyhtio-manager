# V2.8b Cloudflare Worker deployment

## 1. Hyperdrive ID
Cloudflare Dashboard → Storage & Databases → Hyperdrive → `taloyhtio-manager-db` → Settings.
Copy the configuration ID (not a password) and replace:

`REPLACE_WITH_TALOYHTIO_MANAGER_DB_HYPERDRIVE_ID`

in `wrangler.jsonc`.

## 2. GitHub
Create a private repository and upload this package. Do not commit `.dev.vars`, database passwords, access tokens, service-role keys, or connection strings.

## 3. Cloudflare build
Workers & Pages → Create application → Continue with GitHub → select the repository.

Recommended build settings:
- Build command: `npm run build:worker`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`
- Node.js: 22

The Worker uses the existing `HYPERDRIVE` binding and serves `public/` as static assets.

## 4. First verification
- `GET /api/v1/health` must return status `ok`.
- `/` must return the browser UI.
- Admin requests require a real Supabase access token.
- Visitor sessions remain anonymous and database-backed.

## Security
- Hyperdrive stores the database credentials; they are not placed in GitHub.
- The browser never receives a database password, service-role key, or Hyperdrive connection string.
- Query caching remains disabled for revision-sensitive reads.
