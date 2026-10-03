const queryOne = jest.fn();
jest.mock('@/lib/db', () => ({ query: jest.fn(), queryOne: (...a: unknown[]) => queryOne(...a), queryRows: jest.fn() }));

import { buildGraphComponents } from '@/lib/meta-whatsapp';
import { createBusinessTemplateDraft } from '@/lib/whatsapp/tenant-templates';
import { TENANT_WA_EVENTS, TENANT_WA_FIELDS } from '@/lib/whatsapp/tenant-events';

const draft = (body: string, extra: Record<string, unknown> = {}) =>
  createBusinessTemplateDraft('biz-1', 'user-1', { name: 'Order Paid', category: 'UTILITY', body_text: body, ...extra });

beforeEach(() => {
  queryOne.mockReset();
  queryOne.mockImplementation(async (_sql: string, params: unknown[]) => ({ id: 't1', name: params[1], body_text: params[6] }));
});

describe('createBusinessTemplateDraft validation', () => {
  it('accepts a valid body and stores a Meta-safe name', async () => {
    await expect(draft('Hi {{1}}, order {{2}} is paid. Thanks.')).resolves.toMatchObject({ name: 'order_paid' });
  });

  it.each([
    ['gaps in numbering', 'Hi {{1}}, order {{3}} is paid. Thanks.', /without gaps/],
    ['malformed placeholder', 'Hi {{name}}, your order is paid. Thanks.', /look like/],
    ['leading placeholder', '{{1}} your order is paid.', /start or end/],
    ['trailing placeholder', 'Your order is paid {{1}}.', /start or end/],
    ['empty body', '   ', /required/],
  ])('rejects %s before calling Meta', async (_label, body, err) => {
    await expect(draft(body)).rejects.toThrow(err);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('rejects placeholders or line breaks in the header', async () => {
    await expect(draft('Hi there, order paid.', { header_text: 'Hi {{1}}' })).rejects.toThrow(/only allowed/);
    await expect(draft('Hi there, order paid.', { header_text: 'Line\nbreak' })).rejects.toThrow(/single line/);
  });
});

describe('Graph payload for suggested templates', () => {
  it('every suggested template builds a body with one example per placeholder', () => {
    for (const e of TENANT_WA_EVENTS) {
      const s = e.suggested;
      const components = buildGraphComponents({
        category: s.category,
        bodyText: s.body,
        footerText: s.footer,
        exampleVars: s.variableMap.map((k) => TENANT_WA_FIELDS[k].sample),
      });
      const body = components.find((c) => c.type === 'BODY') as { text?: string; example?: { body_text: string[][] } };
      if (s.category === 'AUTHENTICATION') {
        expect(components).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: 'BUTTONS' })]),
        );
        continue;
      }
      expect(body.text).toBe(s.body);
      expect(body.example?.body_text[0]).toHaveLength(s.variableMap.length);
      expect(body.example?.body_text[0].every((v) => v.length > 0)).toBe(true);
    }
  });
});
