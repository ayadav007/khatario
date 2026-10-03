import { createHmac } from 'crypto';
import {
  buildGraphComponents,
  buildInteractiveButtonsPayload,
  buildInteractiveListPayload,
  buildSendComponents,
  countBodyPlaceholders,
  extractInboundMessages,
  extractMessageStatuses,
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

  it('sends AUTH OTP as named code plus copy-code button even if vars are empty', () => {
    const c = buildSendComponents({ category: 'AUTHENTICATION', vars: [] });
    expect(c[0]).toMatchObject({
      type: 'body',
      parameters: [{ type: 'text', text: '123456', parameter_name: 'code' }],
    });
    expect(c[1]).toMatchObject({ type: 'button', sub_type: 'url', index: '0' });
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

describe('sales funnel message parsing and builders', () => {
  const webhook = (value: Record<string, unknown>) => ({ entry: [{ changes: [{ field: 'messages', value }] }] });

  it('reads the ad referral and the tapped option id', () => {
    const [ad, tap, template] = extractInboundMessages(
      webhook({
        contacts: [{ wa_id: '919800000001', profile: { name: 'Ramesh' } }],
        messages: [
          {
            id: 'w1',
            from: '919800000001',
            type: 'text',
            text: { body: 'I want to know about GST billing.' },
            referral: { source_id: '120200', source_type: 'ad', source_url: 'https://fb.me/x', headline: 'GST billing', ctwa_clid: 'clid1' },
          },
          { id: 'w2', from: '919800000001', type: 'interactive', interactive: { list_reply: { id: 'bt_retail', title: 'Retail / Kirana Store' } } },
          { id: 'w3', from: '919800000001', type: 'button', button: { payload: 'Watch Demo', text: 'Watch Demo' } },
        ],
      }),
    );
    expect(ad.profileName).toBe('Ramesh');
    expect(ad.referral).toEqual({ sourceId: '120200', sourceType: 'ad', sourceUrl: 'https://fb.me/x', headline: 'GST billing', body: null, ctwaClid: 'clid1' });
    expect(ad.replyId).toBeNull();
    expect(tap).toMatchObject({ replyId: 'bt_retail', text: 'Retail / Kirana Store', referral: null });
    expect(template).toMatchObject({ replyId: 'Watch Demo', text: 'Watch Demo' });
  });

  it('extracts delivery and read receipts, skipping unknown statuses', () => {
    const statuses = extractMessageStatuses(
      webhook({
        statuses: [
          { id: 'o1', status: 'read', recipient_id: '+91 98000 00001', timestamp: '1700000000' },
          { id: 'o2', status: 'failed', recipient_id: '919800000001', errors: [{ title: 'Re-engagement message' }] },
          { id: 'o3', status: 'deleted' },
        ],
      }),
    );
    expect(statuses).toEqual([
      { messageId: 'o1', status: 'read', recipient: '919800000001', timestamp: 1700000000, errorTitle: null },
      { messageId: 'o2', status: 'failed', recipient: '919800000001', timestamp: null, errorTitle: 'Re-engagement message' },
    ]);
  });

  it('caps reply buttons at 3 with 20-character titles', () => {
    const p = buildInteractiveButtonsPayload({
      body: 'Pick one',
      footer: 'Free trial',
      header: { type: 'image', media: { id: 'm1' } },
      buttons: [
        { id: 'a', title: 'Watch Demo' },
        { id: 'b', title: 'A title that is far too long' },
        { id: 'c', title: 'Talk to Expert' },
        { id: 'd', title: 'Fourth' },
      ],
    }) as { interactive: { header: unknown; footer: unknown; action: { buttons: Array<{ reply: { id: string; title: string } }> } } };
    expect(p.interactive.action.buttons).toHaveLength(3);
    expect(p.interactive.action.buttons[1].reply.title.length).toBeLessThanOrEqual(20);
    expect(p.interactive.header).toEqual({ type: 'image', image: { id: 'm1' } });
    expect(p.interactive.footer).toEqual({ text: 'Free trial' });
    expect(() => buildInteractiveButtonsPayload({ body: 'x', buttons: [] })).toThrow();
  });

  it('caps list rows at 10 and clips titles and descriptions', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `Row number ${i} with a long title`, description: 'd'.repeat(100) }));
    const p = buildInteractiveListPayload({ body: 'Choose', buttonText: 'Choose business', rows }) as {
      interactive: { action: { button: string; sections: Array<{ rows: Array<{ title: string; description: string }> }> } };
    };
    const out = p.interactive.action.sections[0].rows;
    expect(out).toHaveLength(10);
    expect(out[0].title.length).toBeLessThanOrEqual(24);
    expect(out[0].description.length).toBeLessThanOrEqual(72);
    expect(p.interactive.action.button).toBe('Choose business');
  });

  it('builds image-header template components with a sample handle and quick replies', () => {
    const c = buildGraphComponents({
      category: 'MARKETING',
      bodyText: 'Hi {{1}}, still looking?',
      exampleVars: ['Ramesh'],
      headerFormat: 'image',
      headerHandle: '4::aGFuZGxl',
      quickReplies: ['Watch Demo', 'Talk to Expert'],
    });
    expect(c[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::aGFuZGxl'] } });
    expect(c[2]).toEqual({ type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Watch Demo' }, { type: 'QUICK_REPLY', text: 'Talk to Expert' }] });
    expect(() => buildGraphComponents({ category: 'MARKETING', bodyText: 'x', exampleVars: [], headerFormat: 'video' })).toThrow(/sample/);
  });

  it('sends the header media before body variables', () => {
    const c = buildSendComponents({ category: 'MARKETING', vars: ['Ramesh'], headerFormat: 'video', headerMedia: { id: 'vid1' } });
    expect(c).toEqual([
      { type: 'header', parameters: [{ type: 'video', video: { id: 'vid1' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Ramesh' }] },
    ]);
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
    expect(pub.missing).toEqual(expect.arrayContaining(['Access token', 'Phone number ID']));
    expect(pub.missing).not.toContain('App secret');
  });
});
