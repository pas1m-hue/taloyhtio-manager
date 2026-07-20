CREATE INDEX tm_publications_latest_idx
  ON tm_publications (company_id, publication_version DESC);

CREATE INDEX tm_visitor_sessions_company_idx
  ON tm_visitor_sessions (company_id, publication_version);

CREATE INDEX tm_visitor_sessions_expiry_idx
  ON tm_visitor_sessions (expires_at);
