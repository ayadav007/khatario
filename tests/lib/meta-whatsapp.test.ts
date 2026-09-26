import { createHmac } from 'crypto';
import {
  buildGraphComponents,
  countBodyPlaceholders,
  extractTemplateStatusUpdates,
  mapMetaStatus,
  metaWaWebhookChallenge,
  verifyMetaWaWebhookSignature,
} from '@/lib/meta-whatsapp';
import { sanitizeTemplateName } from '@/lib/meta-whatsapp';
import { toPublicMetaWaCredentials } from '@/lib/meta-whatsapp-credentials';
import { toE164Digits } from '@/lib/platform-whatsapp-send';

describe('meta-whatsapp helpers', () => {
  it('counts positional body placeholders', () => {
    expect(countBodyPlaceholders('Hi {{1}}, code {{2}}')).toBe(2);
    expect(countBodyPlaceholders('no vars')).toBe(0);
  });

  it('maps Meta template statuses', () => {
    expect(mapMetaStatus('APPROVED')).toBe('approved');
    expect(mapMetaStatus('REJECTED')).toBe('rejected');
    expect(mapMetaStatus('PENDING')).toBe('pending');
  });

  it('builds AUTHENTICATION components without custom HTML body', () => {
    const c = buildGraphComponents({
      category: 'AUTHENTICATION',
      bodyText: '<b>no</b>',
      exampleVars: ['111111'],
    });
    expect(c[0]).toMatchObject({ type: 'BODY', add_security_recommendation: true });
  });

  it('builds UTILITY body with examples', () => {
    const c = buildGraphComponents({
      category: 'UTILITY',
      bodyText: 'Code {{1}} for {{2}}',
      exampleVars: ['123456', 'Acme'],
    });
    const body = c.find((x) => x.type === 'BODY') as { example?: { body_text: string[][] } };
    expect(body.example?.body_text[0]).toEqual(['123456', 'Acme']);
  });

  it('extracts template status webhook values', () => {
    const updates = extractTemplateStatusUpdates({
      entry: [
        {
          changes: [
            {
              field: 'message_template_status_update',
              value: {
                event: 'APPROVED',
                message_template_name: 'signup_otp_en',
                message_template_language: 'en_US',
              },
            },
          ],
        },
      ],
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].event).toBe('APPROVED');
  });

  it('verifies webhook HMAC and handshake', () => {
    const prevSecret = process.env.META_WA_APP_SECRET;
    const prevToken = process.env.META_WA_VERIFY_TOKEN;
    process.env.META_WA_APP_SECRET = 'app-secret';
    process.env.META_WA_VERIFY_TOKEN = 'verify-me';
    const body = '{"ok":true}';
    const sig = `sha256=${createHmac('sha256', 'app-secret').update(body, 'utf8').digest('hex')}`;
    expect(verifyMetaWaWebhookSignature(body, sig)).toBe(true);
    expect(verifyMetaWaWebhookSignature(body, 'sha256=deadbeef')).toBe(false);
    const q = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'verify-me',
      'hub.challenge': '12345',
    });
    expect(metaWaWebhookChallenge(q)).toBe('12345');
    process.env.META_WA_APP_SECRET = prevSecret;
    process.env.META_WA_VERIFY_TOKEN = prevToken;
  });
});

describe('platform whatsapp naming and phones', () => {
  it('sanitizes Meta-legal template names', () => {
    expect(sanitizeTemplateName('Signup OTP!')).toBe('signup_otp');
    expect(sanitizeTemplateName('9start')).toBe('t_9start');
  });

  it('normalizes Indian 10-digit phones to 91…', () => {
    expect(toE164Digits('9876543210')).toBe('919876543210');
    expect(toE164Digits('+91 98765 43210')).toBe('919876543210');
    expect(toE164Digits('12')).toBeNull();
  });
});

describe('meta whatsapp public credentials', () => {
  it('lists missing fields and never requires env names', () => {
    const pub = toPublicMetaWaCredentials({
      accessToken: '',
      wabaId: 'w',
      phoneNumberId: '',
      appSecret: '',
      verifyToken: 'v',
    });
    expect(pub.ready).toBe(false);
    expect(pub.waba_id).toBe('w');
    expect(pub.has_verify_token).toBe(true);
    expect(pub.missing).toEqual(expect.arrayContaining(['Access token', 'Phone number ID', 'App secret']));
  });
});
