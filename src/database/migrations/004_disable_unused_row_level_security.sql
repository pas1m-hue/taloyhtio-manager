-- Row-level security is for the case where a client talks to the database
-- directly -- Supabase's anon key used from the browser. This architecture is
-- not that: the Cloudflare Worker is the only thing that ever touches the
-- database, and authorization happens in the application layer through JWT
-- verification and tm_company_access_grants. The browser never sees the
-- database at all.
--
-- A permissive policy could therefore not check anything meaningful. It would
-- read "allow all" and give the appearance of security while verifying
-- nothing. RLS is removed rather than given a policy for that reason.
--
-- These three tables had RLS enabled with zero policies, which denies every
-- write. The fault was latent: nothing had ever inserted into tm_publications
-- in this database, so it surfaced only when the first publication was
-- attempted, as an INTERNAL_SERVER_ERROR whose cause was visible only in the
-- server log.
--
-- Every statement is a no-op on a table that already has RLS disabled, so this
-- migration is safe to re-run and safe to apply after the same correction has
-- been made by hand in the Supabase console.
--
-- Scope is the three tables known to be affected. This migration corrects a
-- known state; it is not a standing guard against RLS being switched on again
-- later. That needs a runtime check -- see
-- docs/claude-code-handoff-tietokannan-diagnostiikka.md.
ALTER TABLE tm_publications DISABLE ROW LEVEL SECURITY;
ALTER TABLE tm_visitor_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE tm_visitor_session_access DISABLE ROW LEVEL SECURITY;
