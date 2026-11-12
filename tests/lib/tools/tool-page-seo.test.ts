import { FREE_TOOLS, getFreeTool } from '@/lib/tools/catalogue';
import { hubJsonLd, ratesAsOfLine, toolPageJsonLd, toolPageMetadata } from '@/lib/tools/tool-page-seo';

const site = 'https://khatario.com';
const gst = getFreeTool('gst-calculator')!;

describe('free tool page SEO', () => {
  it('builds metadata with the tool canonical', () => {
    const m = toolPageMetadata(gst);
    expect(m.alternates?.canonical).toBe('/free-tools/gst-calculator');
    expect((m.title as { absolute: string }).absolute).toBe(gst.metaTitle);
    expect(m.description).toBe(gst.metaDescription);
  });
  it('builds tool JSON-LD as a free app with FAQs and breadcrumbs', () => {
    const ld = toolPageJsonLd(gst, site) as { '@graph': Record<string, any>[] };
    const app = ld['@graph'].find((n) => n['@type'] === 'SoftwareApplication')!;
    expect(app.offers).toMatchObject({ '@type': 'Offer', price: '0', priceCurrency: 'INR' });
    expect(app.url).toBe('https://khatario.com/free-tools/gst-calculator');
    expect(ld['@graph'].find((n) => n['@type'] === 'FAQPage')!.mainEntity).toHaveLength(gst.faqs.length);
    expect(ld['@graph'].find((n) => n['@type'] === 'BreadcrumbList')!.itemListElement).toHaveLength(2);
  });
  it('lists every tool on the hub', () => {
    const ld = hubJsonLd(FREE_TOOLS, site) as any;
    expect(ld.mainEntity.itemListElement).toHaveLength(FREE_TOOLS.length);
  });
  it('writes the rates line', () => {
    expect(ratesAsOfLine('2026-11')).toBe('Rates as of November 2026. Check the latest notification before filing.');
  });
});
