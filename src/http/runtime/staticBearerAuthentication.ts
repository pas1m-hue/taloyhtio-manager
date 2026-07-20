import { timingSafeEqual } from "node:crypto";
import type { AuthenticationPort } from "../../auth/authenticationPort.js";
import type { VerifiedIdentity } from "../../auth/authTypes.js";

/** Local/test-only adapter for one opaque bearer token. Never compose it in production. */
export class StaticBearerAuthenticationPort
implements AuthenticationPort<string> {
  readonly #token: Buffer;
  readonly #identity: VerifiedIdentity;

  public constructor(token: string, identity: VerifiedIdentity) {
    if (token.length < 24 || token.length > 512) {
      throw new Error("Static bearer token must contain 24-512 characters.");
    }
    this.#token = Buffer.from(token, "utf8");
    this.#identity = structuredClone(identity);
  }

  public async verify(
    credential: string,
    _asOf: string,
  ): Promise<VerifiedIdentity | undefined> {
    const candidate = Buffer.from(credential, "utf8");
    if (candidate.length !== this.#token.length ||
        !timingSafeEqual(candidate, this.#token)) {
      return undefined;
    }
    return structuredClone(this.#identity);
  }
}
