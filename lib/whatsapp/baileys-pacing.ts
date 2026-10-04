/**
 * QR-linked (Baileys) numbers are personal WhatsApp accounts. Bursts of identical messages are
 * the main trigger for WhatsApp restricting the number, so every automated or bulk send from a
 * QR session is spaced out. Cloud API (WABA) sends are not paced here; Meta rate-limits those.
 */

/** Manual bulk send: the owner is waiting on the request, so gaps stay short and batches small. */
export const BAILEYS_BULK_MAX_BATCH = 15;
export const BAILEYS_BULK_GAP_MS = { min: 1500, max: 3000 } as const;

/** Scheduled reminders run unattended, so they can afford wider, more human-looking gaps. */
export const BAILEYS_SCHEDULED_GAP_MS = { min: 4000, max: 8000 } as const;

export function randomGapMs(range: { min: number; max: number }): number {
  return range.min + Math.floor(Math.random() * (range.max - range.min));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
