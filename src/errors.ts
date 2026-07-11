import { AxiError, exitCodeForError } from "axi-sdk-js";

export type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export { AxiError, exitCodeForError };

/** Shape of a GraphQL error entry from the Linear API. */
export interface LinearGraphQLError {
  message?: string;
  extensions?: {
    code?: string;
    type?: string;
    userPresentableMessage?: string;
    userError?: boolean;
  };
}

/**
 * Map Linear GraphQL/HTTP errors to structured AxiErrors. Prefers Linear's
 * userPresentableMessage, then extension codes, then message heuristics.
 * Never leaks raw GraphQL payloads or stack traces to output.
 */
export function mapLinearError(
  errors: LinearGraphQLError[] | undefined,
  httpStatus: number,
  rateLimitReset?: string,
): AxiError {
  const first = errors?.[0];
  const extCode = (first?.extensions?.code ?? first?.extensions?.type ?? "").toUpperCase();
  const message =
    first?.extensions?.userPresentableMessage ?? first?.message ?? `Linear API returned HTTP ${httpStatus}`;

  if (httpStatus === 429 || extCode === "RATELIMITED" || /rate ?limit/i.test(message)) {
    const resetHint = rateLimitReset ? ` (resets ${formatResetTime(rateLimitReset)})` : "";
    return new AxiError(`Linear API rate limit exceeded${resetHint}`, "RATE_LIMITED", [
      "Wait for the window to reset before retrying",
      "Reduce per-request cost with default fields and lower --limit values",
    ]);
  }

  if (httpStatus === 401 || extCode === "AUTHENTICATION_ERROR" || /authentication/i.test(message)) {
    return authRequiredError();
  }

  if (httpStatus === 403 || extCode === "FORBIDDEN" || /permission|forbidden/i.test(message)) {
    return new AxiError(`Linear denied the request: ${message}`, "FORBIDDEN");
  }

  if (/entity not found|could not find|no such/i.test(message)) {
    return new AxiError(message, "NOT_FOUND");
  }

  if (
    extCode === "INVALID_INPUT" ||
    extCode === "USER_ERROR" ||
    extCode === "GRAPHQL_VALIDATION_FAILED" ||
    first?.extensions?.userError === true ||
    httpStatus === 400
  ) {
    return new AxiError(message, "VALIDATION_ERROR");
  }

  return new AxiError(message, "UNKNOWN");
}

export function authRequiredError(): AxiError {
  return new AxiError("Linear API key required", "AUTH_REQUIRED", [
    "Set the LINEAR_API_KEY environment variable (create a key at https://linear.app/settings/account/security)",
    "Keys stored in ~/.config/linear/credentials.toml (schpet/linear-cli format) are also detected",
  ]);
}

export function networkError(detail: string): AxiError {
  return new AxiError(`Could not reach the Linear API: ${detail}`, "NETWORK_ERROR", [
    "Check network connectivity and retry",
  ]);
}

function formatResetTime(reset: string): string {
  // Header is an epoch-milliseconds timestamp.
  const ms = Number(reset);
  if (!Number.isFinite(ms)) return reset;
  const deltaSec = Math.max(0, Math.round((ms - Date.now()) / 1000));
  if (deltaSec < 120) return `in ${deltaSec}s`;
  return `in ${Math.round(deltaSec / 60)}m`;
}
