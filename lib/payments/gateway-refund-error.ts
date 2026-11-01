/**
 * A refund request the gateway answered with an error. `definite` = the gateway refused it, so no
 * refund exists and a new attempt is safe. Anything not definite (5xx, a broken reply) may still have
 * created the refund: retry with the same idempotency key, never a new one.
 */
export class GatewayRefundError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly definite: boolean,
  ) {
    super(message);
    this.name = 'GatewayRefundError';
  }
}

/**
 * A 4xx is the gateway refusing the request, except 409 (a request with the same key may still be in
 * progress) and 429 (rate limited before it was looked at); both are retried with the same key.
 */
export function isDefiniteRefusalStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}
