import { PLATFORM_TEMPLATE_DEFINITIONS } from '@/lib/platform-email-template-definitions';
import { renderTemplateString } from '@/lib/platform-email-templates';

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
});
