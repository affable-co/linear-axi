/**
 * Shared formatting helpers for consistent count and truncation phrasing.
 *
 * Standard phrases:
 *   count: N                                  — simple count
 *   count: N of T total                       — when total is known
 *   count: N (more available)                 — connection has a next page
 *   count: N (showing first N)                — when truncated by limit
 */

export interface CountLineOptions {
  /** Number of items returned / displayed. */
  count: number;
  /** The request limit; when count === limit, results may be truncated. */
  limit?: number;
  /** True total count when an API provides one. */
  totalCount?: number;
  /** Linear connections expose hasNextPage rather than totalCount. */
  hasMore?: boolean;
  /** Display limit that further truncates results for output. */
  displayLimit?: number;
}

export function formatCountLine(opts: CountLineOptions): string {
  const { count, limit, totalCount, hasMore, displayLimit } = opts;

  // Total count known
  if (totalCount !== undefined && totalCount !== null) {
    return `count: ${count} of ${totalCount} total`;
  }

  // Linear pagination: we only know more pages exist
  if (hasMore) {
    return `count: ${count} (more available)`;
  }

  // Display limit truncation
  if (displayLimit !== undefined && count > displayLimit) {
    return `count: ${count} (showing first ${displayLimit})`;
  }

  // Hit the request limit — results may be truncated
  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count})`;
  }

  // Simple count
  return `count: ${count}`;
}
