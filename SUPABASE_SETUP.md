# Supabase setup checklist for V2.8b

V2.8a does not require a Supabase account. Use this checklist only when the hosted connection is activated.

## 1. Create the project

1. Create a Supabase account and one project.
2. Record the project URL (`https://PROJECT_REF.supabase.co`).
3. Obtain a server-side PostgreSQL connection string from the project dashboard.
4. Keep the database password and connection string only in the Node server environment.

## 2. JWT signing keys

Use Supabase's asymmetric JWT signing keys. V2.8a verifies `ES256` and `RS256` user tokens from:

```text
https://PROJECT_REF.supabase.co/auth/v1/.well-known/jwks.json
```

Legacy `HS256` access tokens are intentionally not accepted by the local JWKS adapter. Do not switch V2.8b on until the project issues asymmetric user JWTs.

## 3. Admin login method

Choose the admin login method later. Suitable first options are:

- email + password
- email magic link
- Google login

The browser receives a Supabase user access token. It sends the token to the Taloyhtiö Manager API as:

```http
Authorization: Bearer <supabase-user-access-token>
```

The browser never sends an alleged subject ID or admin role.

## 4. Database migration

After production environment variables have been configured:

```bash
npm ci --ignore-scripts
npm run build
npm run preflight:production
npm run migrate:production
```

The migration command verifies and applies:

```text
001_persistence_core.sql
002_query_indexes.sql
003_access_control.sql
```

## 5. Create the first company and admin grant

The admin snapshot must exist before its access grant because `tm_company_access_grants.company_id` references `tm_admin_snapshots.company_id`.

After the first company snapshot has been inserted through the planned bootstrap/import path, copy the signed-in user's Supabase `sub` claim and create the grant server-side:

```sql
INSERT INTO tm_company_access_grants
  (company_id, subject_id, role, active, granted_at, granted_by)
VALUES
  ('YOUR_COMPANY_ID', 'SUPABASE_USER_UUID', 'admin', true, now(), 'bootstrap')
ON CONFLICT (company_id, subject_id) DO UPDATE SET
  role = EXCLUDED.role,
  active = true,
  granted_at = EXCLUDED.granted_at,
  granted_by = EXCLUDED.granted_by,
  revoked_at = NULL,
  revoked_by = NULL;
```

Do not use `service_role` tokens as browser bearer credentials. The application expects an authenticated user token and checks the database grant separately.

## 6. Values needed from Supabase

V2.8b needs only:

```text
SUPABASE_URL
DATABASE_URL
```

The issuer and JWKS URL are derived from `SUPABASE_URL`. A Supabase secret/service-role key is not required for the current server architecture.

## 7. Verification before launch

- valid user token reaches the admin API
- expired, anonymous and wrong-project tokens return 401
- a signed-in user without a company grant receives 403
- visitor sessions work without a Supabase account
- production contains no local static admin token
- database and public application connections use TLS
