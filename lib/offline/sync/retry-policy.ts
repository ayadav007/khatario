export interface RetryPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
}

const DEFAULTS: Required<RetryPolicyOptions> = {
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  maxAttempts: 8,
};

/** Exponential backoff with full jitter (AWS-style). */
export function computeRetryDelayMs(
  attempt: number,
  options?: RetryPolicyOptions
): number {
  const { baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...options };
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(Math.random() * exp);
}

export function shouldRetry(
  attempt: number,
  options?: RetryPolicyOptions
): boolean {
  const { maxAttempts } = { ...DEFAULTS, ...options };
  return attempt < maxAttempts;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
