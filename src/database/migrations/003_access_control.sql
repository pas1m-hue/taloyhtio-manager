CREATE TABLE tm_company_access_grants (
  company_id text NOT NULL REFERENCES tm_admin_snapshots(company_id) ON DELETE CASCADE,
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  role text NOT NULL CHECK (role = 'admin'),
  active boolean NOT NULL,
  granted_at timestamptz NOT NULL,
  granted_by text NOT NULL CHECK (btrim(granted_by) <> ''),
  revoked_at timestamptz,
  revoked_by text,
  PRIMARY KEY (company_id, subject_id),
  CHECK (
    (active AND revoked_at IS NULL AND revoked_by IS NULL)
    OR
    (NOT active AND revoked_at IS NOT NULL AND btrim(revoked_by) <> '')
  )
);

CREATE INDEX tm_company_access_subject_idx
  ON tm_company_access_grants(subject_id, active);

CREATE TABLE tm_visitor_session_access (
  session_id text PRIMARY KEY
    REFERENCES tm_visitor_sessions(session_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE
    CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX tm_visitor_session_access_expiry_idx
  ON tm_visitor_session_access(expires_at)
  WHERE revoked_at IS NULL;
