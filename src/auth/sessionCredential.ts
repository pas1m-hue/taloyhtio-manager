import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { DomainValidationError } from "../domain/types.js";
import type { VisitorSessionCredential } from "./authTypes.js";

export interface SessionCredentialGenerator {
  create(): VisitorSessionCredential;
}

export class SecureSessionCredentialGenerator
implements SessionCredentialGenerator {
  public create(): VisitorSessionCredential {
    return {
      sessionId: randomUUID(),
      accessToken: randomBytes(32).toString("base64url"),
    };
  }
}

export function hashVisitorAccessToken(accessToken: string): string {
  validateRawAccessToken(accessToken);
  return createHash("sha256").update(accessToken, "utf8").digest("hex");
}

export function validateRawAccessToken(accessToken: string): void {
  if (accessToken.length < 32 || accessToken.length > 256 ||
      !/^[A-Za-z0-9_-]+$/.test(accessToken)) {
    throw new DomainValidationError(
      "INVALID_SESSION_CREDENTIAL",
      "Visitor session credential is invalid.",
    );
  }
}

export function tokenHashesEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}
