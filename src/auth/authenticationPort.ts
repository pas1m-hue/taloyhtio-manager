import type { VerifiedIdentity } from "./authTypes.js";

/**
 * Adapter boundary for Supabase Auth, OIDC, reverse-proxy auth, or another
 * trusted server-side identity provider. The application never parses a
 * browser token itself.
 */
export interface AuthenticationPort<Credential> {
  verify(
    credential: Credential,
    asOf: string,
  ): Promise<VerifiedIdentity | undefined>;
}

/** Test-only credential verifier. Never use this adapter in production. */
export class InMemoryAuthenticationPort
implements AuthenticationPort<string> {
  readonly #identities = new Map<string, VerifiedIdentity>();

  public constructor(entries: Readonly<Record<string, VerifiedIdentity>> = {}) {
    for (const [credential, identity] of Object.entries(entries)) {
      this.#identities.set(credential, structuredClone(identity));
    }
  }

  public async verify(
    credential: string,
    _asOf: string,
  ): Promise<VerifiedIdentity | undefined> {
    const identity = this.#identities.get(credential);
    return identity === undefined ? undefined : structuredClone(identity);
  }
}
