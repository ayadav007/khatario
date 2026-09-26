import { PLATFORM_TEMPLATE_DEFINITIONS } from '@/lib/platform-email-template-definitions';
import { renderTemplateString, sanitizeStoredTemplates } from '@/lib/platform-email-templates';

describe('platform email templates', () => {
  it('includes welcome and admin signup copy', () => {
    const ids = PLATFORM_TEMPLATE_DEFINITIONS.map((d) => d.id);
    expect(ids).toContain('welcome');
    expect(ids).toContain('admin_new_signup');
  });

  it('fills supportEmail when env is unset', () => {
    const html = renderTemplateString('Write to {{supportEmail}}', {});
    expect(html).toContain('@');
  });

  it('keeps custom templates and drops unknown keys', () => {
    const next = sanitizeStoredTemplates({
      welcome: { subject: 'Hi', body_html: '<p>x</p>' },
      custom_abc: { label: 'Promo', subject: 'Sale', body_html: '<p>y</p>' },
      evil: { subject: 'no' },
    });
    expect(next.welcome?.subject).toBe('Hi');
    expect(next.custom_abc?.label).toBe('Promo');
    expect(next.evil).toBeUndefined();
  });
});
