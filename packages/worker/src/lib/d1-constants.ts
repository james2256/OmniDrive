/**
 * D1's hard limit on bound parameters per query.
 *
 * Cloudflare D1 rejects queries with more than 100 bind variables with
 * "D1_ERROR: too many SQL variables at offset N: SQLITE_ERROR".
 *
 * All IN (?, ?, ...) query builders must chunk their input to stay under
 * this limit. Use `D1_MAX_BIND_VARIABLES - 1` for IN clauses that also
 * bind a WHERE column (e.g. `WHERE drive_account_id = ? AND id IN (...)`
 * has 1 + N variables, so N must be ≤ 99).
 *
 * Reference: https://developers.cloudflare.com/d1/platform/limits/
 */
export const D1_MAX_BIND_VARIABLES = 100;

/**
 * Runtime guard: throws if a query would exceed D1's bind variable limit.
 *
 * Call this in every IN (?, ?, ...) query builder before calling .bind().
 * This catches overflow in ANY environment — including local tests where
 * SQLite's default limit (32766) is higher than D1's (100), so the bug
 * wouldn't otherwise surface until production.
 *
 * @param bindCount - Total bind variables in the query (IN items + WHERE binds)
 * @param context - Label for the error message (e.g. 'findExistingForDelta')
 */
export function assertWithinD1Limit(bindCount: number, context: string): void {
  if (bindCount > D1_MAX_BIND_VARIABLES) {
    throw new Error(
      `${context}: ${bindCount} bind variables exceeds D1's limit of ${D1_MAX_BIND_VARIABLES}. ` +
        'Chunk the input array to stay under the limit.',
    );
  }
}
