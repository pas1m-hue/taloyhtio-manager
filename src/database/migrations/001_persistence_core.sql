CREATE TABLE tm_admin_snapshots (
  company_id text PRIMARY KEY CHECK (btrim(company_id) <> ''),
  revision bigint NOT NULL CHECK (revision >= 0),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tm_publications (
  company_id text NOT NULL REFERENCES tm_admin_snapshots(company_id) ON DELETE RESTRICT,
  publication_version bigint NOT NULL CHECK (publication_version > 0),
  source_admin_revision bigint NOT NULL CHECK (source_admin_revision >= 0),
  content_fingerprint text NOT NULL CHECK (btrim(content_fingerprint) <> ''),
  payload jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  published_by text NOT NULL CHECK (btrim(published_by) <> ''),
  PRIMARY KEY (company_id, publication_version)
);

CREATE TABLE tm_visitor_sessions (
  session_id text PRIMARY KEY CHECK (btrim(session_id) <> ''),
  company_id text NOT NULL,
  publication_version bigint NOT NULL CHECK (publication_version > 0),
  publication_fingerprint text NOT NULL CHECK (btrim(publication_fingerprint) <> ''),
  revision bigint NOT NULL CHECK (revision >= 0),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  FOREIGN KEY (company_id, publication_version)
    REFERENCES tm_publications(company_id, publication_version)
    ON DELETE RESTRICT
);
