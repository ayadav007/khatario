import { finishCreditAlert } from '@/lib/credit-alert-finish';

describe('finishCreditAlert', () => {
  it('completes when the alert returns void and still reports a rejected alert', async () => {
    await expect(finishCreditAlert(undefined)).resolves.toBeUndefined();
    await expect(finishCreditAlert(Promise.resolve())).resolves.toBeUndefined();
    await expect(finishCreditAlert(Promise.reject(new Error('whatsapp down')))).rejects.toThrow('whatsapp down');
  });
});
