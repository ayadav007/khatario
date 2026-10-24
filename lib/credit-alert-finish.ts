/**
 * The purchase and invoice routes await this. A caller that returns void
 * (a test double that did not send) must not be treated as a failed promise.
 * A rejected promise still rejects so the caller can record the failure.
 */
export async function finishCreditAlert(result: Promise<void> | void): Promise<void> {
  await result;
}
