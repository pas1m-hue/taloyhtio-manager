# Taloyhtiö Manager V2.8a HTTP API

Base path: `/api/v1`

All mutation bodies use `Content-Type: application/json`. Unknown top-level fields are rejected. API responses use `Cache-Control: no-store`.

## Error format

```json
{
  "error": {
    "code": "ADMIN_REVISION_CONFLICT",
    "message": "...",
    "requestId": "..."
  }
}
```

Typical mapping:

| HTTP | Meaning |
|---:|---|
| 400 | Invalid HTTP or domain input |
| 401 | Missing/invalid admin identity |
| 403 | Authenticated identity lacks company admin access |
| 404 | Admin data or route not found |
| 409 | Revision or proposal conflict |
| 500 | Database integrity or unexpected server error |

## Unauthenticated routes

Only `GET /health` answers without a bearer token. There is no public or
visitor API: the publication and visitor-session routes were removed, and
their former paths return the standard `404 HTTP_ROUTE_NOT_FOUND`.

## Admin workspace

Every admin route requires:

```http
Authorization: Bearer <credential>
```

### `GET /admin/companies/:companyId/workspace`

Query:

```text
startYear=2026&endYear=2057
```

Returns the persistent workspace, audit trail and calculations.

### `GET /admin/companies/:companyId/preview`

Uses the same horizon query and returns calculation read models without the full admin payload.

### `POST /admin/companies/:companyId/changes`

```json
{
  "expectedRevision": 0,
  "horizon": { "startYear": 2026, "endYear": 2057 },
  "operations": [
    {
      "type": "save_liquidity_baseline",
      "value": {
        "id": "liquidity_2026_12_31",
        "asOfDate": "2026-12-31",
        "currentCash": 25000,
        "sourceIds": ["manual_2026"]
      },
      "sourceIds": ["manual_2026"],
      "explanation": "Adminin tarkistama manuaalinen päivitys."
    }
  ]
}
```

The server inserts `companyId`, verified actor and server time. All operations are committed atomically through the V2.1 batch service.

## Trusted metadata rejection

The browser is not allowed to send trusted server metadata anywhere in a request body, including nested objects. Rejected field names include:

```text
actorId
occurredAt
publishedBy
publishedAt
updatedBy
updatedAt
createdAt
expiresAt
grantedBy
grantedAt
```

## Production admin credential

In V2.8a production mode, the bearer value is a Supabase Auth user access token signed with an asymmetric `ES256` or `RS256` project key. The API verifies the JWT locally against the project JWKS, checks `iss`, `aud`, `exp`, `iat`, optional `nbf`, `sub`, `role`, `session_id`, `aal` and anonymous-user state, then checks the user's company grant in PostgreSQL.

The API does not accept a publishable key, service-role token, anonymous token, legacy HS256 token, browser-supplied subject ID or browser-supplied role as an admin credential.

The local static bearer adapter remains available only through the development server composition root.
