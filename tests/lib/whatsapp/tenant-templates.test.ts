const meta = {
  isMetaWaConfigured: jest.fn(),
  sendTemplateMessage: jest.fn(),
  uploadMedia: jest.fn(),
};
const resolveEventTemplate = jest.fn();

jest.mock('@/lib/meta-whatsapp', () => ({ ...jest.requireActual('@/lib/meta-whatsapp'), ...meta }));
jest.mock('@/lib/whatsapp/tenant-templates', () => ({
  resolveEventTemplate: (...a: unknown[]) => resolveEventTemplate(...a),
}));
jest.mock('@/lib/platform-whatsapp-send', () => ({
  toE164Digits: jest.requireActual('@/lib/platform-whatsapp-send').toE164Digits,
}));
jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: jest.fn() }));

import { buildTemplateSendComponents, graphErrorMessage } from '@/lib/meta-whatsapp';
import {
  TENANT_WA_EVENTS,
  countPlaceholders,
  getTenantWaEvent,
  previewTemplateBody,
  templateEventMismatch,
} from '@/lib/whatsapp/tenant-events';
import { sendEventTemplate } from '@/lib/whatsapp/tenant-send';

const utility = (body: string, extra: Record<string, unknown> = {}) => ({
  id: 't1',
  name: 'order_paid',
  language: 'en_US',
  category: 'UTILITY',
  header_format: 'none',
  body_text: body,
  placeholder_count: countPlaceholders(body),
  status: 'approved',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('event registry', () => {
  it('suggested templates use exactly their variable map and allowed fields', () => {
    for (const e of TENANT_WA_EVENTS) {
      if (e.suggested.category === 'AUTHENTICATION') continue;
      expect(countPlaceholders(e.suggested.body)).toBe(e.suggested.variableMap.length);
      for (const k of e.suggested.variableMap) expect(e.fields).toContain(k);
      expect(e.suggested.body).not.toMatch(/^\s*\{\{|\}\}\s*[.!?]?\s*$/);
    }
  });

  it('flags wrong category, count and fields', () => {
    const paid = getTenantWaEvent('store_order_paid');
    expect(templateEventMismatch(paid, { category: 'MARKETING', placeholder_count: 0, status: 'approved' }, [])).toMatch(
      /utility/,
    );
    expect(templateEventMismatch(paid, { category: 'UTILITY', placeholder_count: 2, status: 'approved' }, ['total'])).toMatch(
      /2 placeholders/,
    );
    expect(
      templateEventMismatch(paid, { category: 'UTILITY', placeholder_count: 1, status: 'approved' }, ['invoice_number']),
    ).toMatch(/not available/);
    expect(templateEventMismatch(paid, { category: 'UTILITY', placeholder_count: 1, status: 'approved' }, ['total'])).toBeNull();
  });

  it('rejects headers and buttons Khatario cannot fill for the event', () => {
    const paid = getTenantWaEvent('store_order_paid');
    const invoice = getTenantWaEvent('invoice_sent');
    const t = { category: 'UTILITY', placeholder_count: 0, status: 'approved' };
    expect(templateEventMismatch(paid, { ...t, header_format: 'document' }, [])).toMatch(/PDF header/);
    expect(templateEventMismatch(invoice, { ...t, header_format: 'document' }, [])).toBeNull();
    expect(templateEventMismatch(invoice, { ...t, header_format: 'image' }, [])).toMatch(/image or video/);
    expect(templateEventMismatch(paid, { ...t, header_format: 'text', header_text: 'Hi {{1}}' }, [])).toMatch(/header/);
    expect(
      templateEventMismatch(paid, { ...t, buttons: [{ type: 'URL', text: 'Track', url: 'https://x.in/{{1}}' }] }, []),
    ).toMatch(/variable link/);
    expect(
      templateEventMismatch(paid, { ...t, buttons: [{ type: 'URL', text: 'Shop', url: 'https://x.in/shop' }] }, []),
    ).toBeNull();
  });

  it('previews with sample values', () => {
    expect(previewTemplateBody('Hi {{1}}, order {{2}}.', ['customer_name', 'order_number'])).toBe('Hi Priya, order SO-1042.');
  });
});

describe('buildTemplateSendComponents', () => {
  it('fills body params in order and replaces blanks with a dash', () => {
    expect(buildTemplateSendComponents({ category: 'UTILITY', header_format: 'none', placeholder_count: 2 }, ['Priya', ''])).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: '-' }] },
    ]);
  });

  it('strips newlines, tabs and long space runs that Graph rejects in parameters', () => {
    const [body] = buildTemplateSendComponents({ category: 'UTILITY', header_format: 'none', placeholder_count: 1 }, [
      'Do you\ndeliver\tto     Baner?',
    ]);
    expect(body).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'Do you deliver to   Baner?' }] });
  });

  it('adds a document header when the template has one', () => {
    const c = buildTemplateSendComponents({ category: 'UTILITY', header_format: 'document', placeholder_count: 0 }, [], {
      mediaId: 'm1',
      filename: 'INV-1.pdf',
    });
    expect(c).toEqual([
      { type: 'header', parameters: [{ type: 'document', document: { id: 'm1', filename: 'INV-1.pdf' } }] },
    ]);
  });

  it('puts the code in the body and copy-code button for authentication templates', () => {
    const c = buildTemplateSendComponents({ category: 'AUTHENTICATION', header_format: 'none', placeholder_count: 1 }, ['123456']);
    expect(c).toHaveLength(2);
    expect(c[1]).toMatchObject({ type: 'button', sub_type: 'url', parameters: [{ text: '123456' }] });
  });
});

describe('graphErrorMessage', () => {
  it('surfaces the user-facing reason behind "Invalid parameter" and keeps the code', () => {
    const msg = graphErrorMessage(
      {
        error: {
          message: 'Invalid parameter',
          code: 100,
          error_subcode: 2388043,
          error_user_title: 'Message template "components" param is missing expected field(s)',
          error_user_msg: 'component of type BODY is missing expected field(s) (example)',
        },
      },
      400,
    );
    expect(msg).toBe(
      'Message template "components" param is missing expected field(s): component of type BODY is missing expected field(s) (example). Invalid parameter (code 100/2388043)',
    );
  });

  it('keeps the plain message and code when there are no user fields', () => {
    expect(graphErrorMessage({ error: { message: 'Template name does not exist', code: 132001 } }, 404)).toBe(
      'Template name does not exist (code 132001)',
    );
    expect(graphErrorMessage(null, 500)).toBe('Graph API 500');
  });
});

describe('sendEventTemplate', () => {
  const base = { businessId: 'biz-1', eventKey: 'store_order_paid' as const, to: '9876543210' };

  it('reports not_configured without Cloud credentials', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(false);
    await expect(sendEventTemplate({ ...base, values: {} })).resolves.toEqual({ sent: false, reason: 'not_configured' });
  });

  it('reports no_template when nothing approved is chosen', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    resolveEventTemplate.mockResolvedValue(null);
    await expect(sendEventTemplate({ ...base, values: {} })).resolves.toEqual({ sent: false, reason: 'no_template' });
  });

  it('sends the chosen template with mapped values to the E.164 number', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    resolveEventTemplate.mockResolvedValue({
      template: utility('Hi {{1}}, order {{2}} paid.'),
      variableMap: ['customer_name', 'order_number'],
    });
    meta.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' });

    const res = await sendEventTemplate({ ...base, values: { customer_name: 'Priya', order_number: 'SO-9' } });
    expect(res).toEqual({ sent: true, messageId: 'wamid.1', template: 'order_paid' });
    expect(meta.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '919876543210',
        name: 'order_paid',
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Priya' }, { type: 'text', text: 'SO-9' }] }],
      }),
    );
  });

  it('uploads the PDF for document-header templates', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    resolveEventTemplate.mockResolvedValue({
      template: utility('Invoice {{1}} attached for you.', { header_format: 'document' }),
      variableMap: ['invoice_number'],
    });
    meta.uploadMedia.mockResolvedValue('media-1');
    meta.sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.2' });

    const res = await sendEventTemplate({
      ...base,
      eventKey: 'invoice_sent',
      values: { invoice_number: 'INV-1' },
      document: { buffer: Buffer.from('pdf'), filename: 'INV-1.pdf' },
    });
    expect(res.sent).toBe(true);
    expect(meta.uploadMedia).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'application/pdf', filename: 'INV-1.pdf' }));
  });

  it('returns failed (for the caller to fall back) when Meta errors', async () => {
    meta.isMetaWaConfigured.mockResolvedValue(true);
    resolveEventTemplate.mockResolvedValue({ template: utility('Hi {{1}} there.'), variableMap: ['customer_name'] });
    meta.sendTemplateMessage.mockRejectedValue(new Error('(#131026) Message undeliverable'));
    await expect(sendEventTemplate({ ...base, values: {} })).resolves.toMatchObject({ sent: false, reason: 'failed' });
  });
});
