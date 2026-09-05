import { DomainValidationError, type ValidationCode } from "../domain/types.js";

export interface HttpErrorPayload {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

export class HttpRequestValidationError extends Error {
  public readonly code = "INVALID_HTTP_REQUEST";

  public constructor(message: string) {
    super(message);
    this.name = "HttpRequestValidationError";
  }
}

export interface MappedHttpError {
  readonly statusCode: number;
  readonly code: string;
  readonly message: string;
}

export function mapHttpError(error: unknown): MappedHttpError {
  if (error instanceof HttpRequestValidationError) {
    return { statusCode: 400, code: error.code, message: error.message };
  }
  if (error instanceof DomainValidationError) {
    const statusCode = statusForDomainCode(error.code);
    return {
      statusCode,
      code: error.code,
      message: statusCode >= 500 ? "Internal server error." : error.message,
    };
  }
  return {
    statusCode: 500,
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error.",
  };
}

function statusForDomainCode(code: ValidationCode): number {
  switch (code) {
    case "UNAUTHENTICATED":
    case "INVALID_AUTH_CONTEXT":
    case "INVALID_SESSION_CREDENTIAL":
      return 401;
    case "ACCESS_DENIED":
    case "INVALID_ACCESS_GRANT":
      return 403;
    case "ADMIN_DATA_NOT_FOUND":
    case "PUBLISHED_DATA_NOT_FOUND":
    case "SESSION_NOT_FOUND":
      return 404;
    case "ADMIN_DATA_ALREADY_EXISTS":
    case "ADMIN_REVISION_CONFLICT":
    case "PUBLISHED_VERSION_CONFLICT":
    case "NO_PUBLICATION_CHANGES":
    case "SESSION_ALREADY_EXISTS":
    case "SESSION_REVISION_CONFLICT":
    case "SESSION_PUBLICATION_MISMATCH":
    case "CHANGE_PROPOSAL_CONFLICT":
    case "CHANGE_PROPOSAL_ALREADY_DECIDED":
    case "DUPLICATE_CHANGE_PROPOSAL_ID":
    // The delete target was there when the caller computed its cascade and is
    // gone now — a concurrent change, not a malformed request.
    case "DELETE_TARGET_NOT_FOUND":
      return 409;
    case "SESSION_EXPIRED":
      return 410;
    case "DATABASE_MIGRATION_CONFLICT":
    case "DATABASE_INTEGRITY_ERROR":
    // A server misconfiguration, not a bad request: the caller did nothing
    // wrong and cannot fix it by retrying or by changing input. The message is
    // withheld like every other 500's; the code is what reaches the client.
    case "DATABASE_ACCESS_POLICY_ERROR":
      return 500;
    default:
      return 400;
  }
}
