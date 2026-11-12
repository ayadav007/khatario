import { FREE_TOOLS } from '@/lib/tools/catalogue';
import { LANDING_FREE_TOOLS_DEFAULTS, resolveFreeToolCards } from '@/lib/marketing/free-tools-section';
import { KHATARIO_BLOCKS } from '@/lib/marketing-builder/block-types';
import { HOME_SECTIONS } from '@/lib/marketing-builder/default-home';

describe('free tools home section', () => {
  it('defaults to six real tools', () => {
    const cards = resolveFreeToolCards(LANDING_FREE_TOOLS_DEFAULTS.toolSlugs);
    expect(cards.map((c) => c.slug)).toEqual(['invoice-maker', 'gst-calculator', 'gstin-validator', 'hsn-finder', 'emi-calculator', 'price-margin-calculator']);
  });
  it('drops unknown slugs and caps at six', () => {
    const many = FREE_TOOLS.map((t) => ({ slug: t.slug }));
    expect(resolveFreeToolCards([{ slug: 'nope' }, ...many])).toHaveLength(6);
    expect(resolveFreeToolCards([{ slug: 'nope' }])).toEqual([]);
  });
  it('treats a non-array as an empty list', () => {
    expect(resolveFreeToolCards(5 as unknown as { slug: string }[])).toEqual([]);
    expect(resolveFreeToolCards({ slug: 'gst-calculator' } as unknown as { slug: string }[])).toEqual([]);
  });
  it('shows a repeated slug once', () => {
    const cards = resolveFreeToolCards([{ slug: 'gst-calculator' }, { slug: 'gst-calculator' }, { slug: 'hsn-finder' }]);
    expect(cards.map((c) => c.slug)).toEqual(['gst-calculator', 'hsn-finder']);
  });
  it('is a Site Builder block on the default home page after AiTools', () => {
    expect(KHATARIO_BLOCKS).toContain('FreeTools');
    const i = HOME_SECTIONS.indexOf('AiTools');
    expect(HOME_SECTIONS[i + 1]).toBe('FreeTools');
  });
});
