const meta = {
  isMetaWaConfigured: jest.fn(),
  sendTemplateMessage: jest.fn(),
  createMessageTemplate: jest.fn(),
  listMessageTemplates: jest.fn(),
};
const sendWhatsAppMessage = jest.fn();
const sendPlatformEventWhatsApp = jest.fn();

jest.mock('@/lib/meta-whatsapp', () => {
  const actual = jest.requireActual('@/lib/meta-whatsapp');
  return { ...actual, ...meta };
});
jest.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage }));
jest.mock('@/lib/platform-whatsapp-send', () => ({
  toE164Digits: jest.requireActual('@/lib/platform-whatsapp-send').toE164Digits,
  sendPlatformEventWhatsApp,
}));
jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn() }));
const sendEventTemplate = jest.fn();
jest.mock('@/lib/whatsapp/tenant-send', () => ({
  sendEventTemplate: (...args: unknown[]) => sendEventTemplate(...args),
  notifyBusinessEvent: jest.fn(),
}));

import { STORE_OTP_TEMPLATE, notifyStoreCustomerWhatsApp, sendStoreOtpWhatsApp } from '@/lib/store/notify-whatsapp';

const input = { businessId: 'biz-1', storeName: 'Scalefusion', phone: '7769870606', code: '482913' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  sendPlatformEventWhatsApp.mockResolvedValue({ sent: false, skipped: 'META_WA_NOT_CONFIGURED' });
  sendEventTemplate.mockResolvedValue({ sent: false, reason: 'no_template' });
});

describe('sendStoreOtpWhatsApp', () => {
  it('sends the authentication template from the merchant Cloud API number with the 91 prefix', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    meta.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });

    await expect(sendStoreOtpWhatsApp(input)).resolves.toEqual({ sent: true, via: 'cloud' });
    expect(meta.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-1', to: '917769870606', name: STORE_OTP_TEMPLATE }),
    );
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('uses the template the merchant chose for store_otp before the default', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    sendEventTemplate.mockResolvedValue({ sent: true, messageId: 'wamid.9', template: 'my_otp' });

    await expect(sendStoreOtpWhatsApp(input)).resolves.toEqual({ sent: true, via: 'cloud' });
    expect(sendEventTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'store_otp', to: '917769870606', values: { code: '482913' } }),
    );
    expect(meta.sendTemplateMessage).not.toHaveBeenCalled();
  });

  it('creates the template on first use and sends once Meta approves it', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    meta.sendTemplateMessage
      .mockRejectedValueOnce(new Error('(#132001) Template name does not exist in the translation'))
      .mockResolvedValueOnce({ messageId: 'wamid.2' });
    meta.createMessageTemplate.mockResolvedValue({ id: 't1', status: 'APPROVED' });

    await expect(sendStoreOtpWhatsApp(input)).resolves.toEqual({ sent: true, via: 'cloud' });
    expect(meta.createMessageTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz-1', category: 'AUTHENTICATION', name: STORE_OTP_TEMPLATE }),
    );
    expect(meta.sendTemplateMessage).toHaveBeenCalledTimes(2);
  });

  it('falls back to the QR session when the template is still pending', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    meta.sendTemplateMessage.mockRejectedValue(new Error('(#132001) Template name does not exist'));
    meta.createMessageTemplate.mockResolvedValue({ id: 't1', status: 'PENDING' });
    sendWhatsAppMessage.mockResolvedValue('msg-1');

    await expect(sendStoreOtpWhatsApp(input)).resolves.toEqual({ sent: true, via: 'qr' });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith(
      'biz-1',
      '917769870606',
      expect.stringContaining('482913'),
      undefined,
      'text',
    );
  });

  it('reports failure when no channel can deliver', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(false);
    sendWhatsAppMessage.mockRejectedValue(new Error('WhatsApp is not connected.'));

    const res = await sendStoreOtpWhatsApp(input);
    expect(res.sent).toBe(false);
    expect(sendPlatformEventWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ eventKey: 'signup_otp', toPhone: '917769870606', vars: ['482913'] }),
    );
  });
});

describe('notifyStoreCustomerWhatsApp', () => {
  it('adds the India country code to 10-digit numbers', async () => {
    sendWhatsAppMessage.mockResolvedValue('msg-1');
    await notifyStoreCustomerWhatsApp({ businessId: 'biz-1', phone: '7769870606', text: 'Order placed' });
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('biz-1', '917769870606', 'Order placed', undefined, 'text');
  });
});
