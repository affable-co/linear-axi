import { resolveApiKey } from "./auth.js";
import { mapLinearError, networkError, type LinearGraphQLError } from "./errors.js";

/**
 * Thin GraphQL client for the Linear API. This is the single seam commands
 * (and tests) interact with — no SDK, hand-written minimal queries only.
 *
 * Linear budget rules that shape this module: max 10,000 complexity points per
 * query and 3M points/hour per user, so every query must select only the
 * fields it renders.
 */

export const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
export const LINEAR_REQUEST_TIMEOUT_MS = 30_000;

export interface GqlResult<T> {
  data?: T;
  errors?: LinearGraphQLError[];
  status: number;
}

/**
 * Execute a GraphQL request and return data, mapping every failure mode
 * (network, HTTP, GraphQL errors array) to a structured AxiError.
 */
export async function gqlQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const result = await gqlRaw<T>(query, variables);
  if (result.errors?.length || !result.data) {
    throw mapLinearError(result.errors, result.status, result.rateLimitReset);
  }
  return result.data;
}

export interface GqlRawResult<T> extends GqlResult<T> {
  rateLimitReset?: string;
}

/**
 * Execute a GraphQL request without throwing on GraphQL-level errors.
 * Network failures still throw (there is nothing structured to return).
 */
export async function gqlRaw<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<GqlRawResult<T>> {
  const apiKey = resolveApiKey();

  let response: Response;
  try {
    response = await fetch(LINEAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Personal API keys are sent bare; OAuth tokens would use Bearer.
        Authorization: apiKey.startsWith("Bearer ") ? apiKey : formatAuthHeader(apiKey),
      },
      body: JSON.stringify(variables ? { query, variables } : { query }),
      signal: AbortSignal.timeout(LINEAR_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw networkError(`request timed out after ${LINEAR_REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw networkError(error instanceof Error ? error.message : String(error));
  }

  const rateLimitReset =
    response.headers.get("x-ratelimit-requests-reset") ??
    response.headers.get("x-ratelimit-complexity-reset") ??
    undefined;

  let body: { data?: T; errors?: LinearGraphQLError[] };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw mapLinearError(
      [{ message: `Linear API returned a non-JSON response (HTTP ${response.status})` }],
      response.status,
      rateLimitReset,
    );
  }

  return { data: body.data, errors: body.errors, status: response.status, rateLimitReset };
}

function formatAuthHeader(apiKey: string): string {
  // lin_api_* personal keys are sent as-is; lin_oauth_* need Bearer.
  return apiKey.startsWith("lin_oauth_") ? `Bearer ${apiKey}` : apiKey;
}
