/**
 * Tells a screen whether a response belongs to its most recent request. A list that refetches
 * when its filters change can get the responses back out of order; only the latest one may
 * update the screen, or an earlier filter's (often empty) result overwrites the right one.
 */
export function createLatestRequest() {
  let current = 0;
  return {
    /** Mark a new request as the current one; keep the token to check the response. */
    start(): number {
      current += 1;
      return current;
    },
    /** True while no later request has started. */
    isLatest(token: number): boolean {
      return token === current;
    },
  };
}

export type LatestRequest = ReturnType<typeof createLatestRequest>;
