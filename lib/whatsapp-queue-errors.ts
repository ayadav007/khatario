/**
 * Errors and classification for WhatsApp queue jobs (BullMQ retry vs UnrecoverableError).
 */

/** Attach `.retryable` for explicit classification; worker maps false → UnrecoverableError. */
export class WhatsAppQueueJobError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'WhatsAppQueueJobError';
    this.retryable = retryable;
  }
}

function pgCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = (err as { code?: string }).code;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

function isPgError(err: unknown): boolean {
  return err != null && typeof err === 'object' && 'code' in err;
}

/**
 * false → do not retry (validation, bad data, unrecoverable).
 * true  → retry (transient DB / network / deadlock).
 */
export function classifyErrorRetryable(err: unknown): boolean {
  if (err instanceof WhatsAppQueueJobError) {
    return err.retryable;
  }
  if (err && typeof err === 'object' && 'retryable' in err) {
    const r = (err as { retryable?: boolean }).retryable;
    if (r === false) {
      return false;
    }
    if (r === true) {
      return true;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  if (/Missing required fields/i.test(msg) || /validation/i.test(msg) || /Invalid /i.test(msg)) {
    return false;
  }

  if (!isPgError(err) && 'errno' in (err as object)) {
    const e = err as { code?: string; errno?: string };
    const c = e.code;
    if (c === 'ECONNRESET' || c === 'ETIMEDOUT' || c === 'ECONNREFUSED' || c === 'ENETUNREACH') {
      return true;
    }
  }

  if (!isPgError(err) && (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('socket'))) {
    return true;
  }

  const code = pgCode(err);
  if (!code) {
    return true;
  }

  if (code.startsWith('08')) {
    return true;
  }
  if (code === '40001' || code === '40P01' || code === '55P03') {
    return true;
  }
  if (code === '22P02' || code === '23502' || code === '23514' || code === '23516') {
    return false;
  }
  if (code === '23505') {
    return false;
  }

  if (/^[0-9A-Z]{5}$/.test(code)) {
    if (code.startsWith('2') || code.startsWith('3')) {
      return false;
    }
  }

  return true;
}
