import fs from 'fs';
import path from 'path';
import { FREE_TOOLS, FREE_TOOL_PATHS, getFreeTool } from '@/lib/tools/catalogue';
import { TDS_PUBLIC } from '@/lib/tools/tds-rates';

describe('free tools catalogue', () => {
  it('has unique slugs and valid links between tools', () => {
    const slugs = FREE_TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs[0]).toBe('invoice-maker');
    for (const t of FREE_TOOLS) {
      expect(t.related.length).toBeGreaterThanOrEqual(2);
      expect(t.related.length).toBeLessThanOrEqual(3);
      for (const r of t.related) {
        expect(slugs).toContain(r);
        expect(r).not.toBe(t.slug);
      }
      expect(t.faqs.length).toBeGreaterThanOrEqual(2);
      expect(t.faqs.length).toBeLessThanOrEqual(3);
      expect(t.howItWorks.length).toBeGreaterThanOrEqual(2);
      expect(t.howItWorks.length).toBeLessThanOrEqual(4);
      expect(t.metaTitle.length).toBeLessThan(60);
      expect(t.metaDescription.length).toBeLessThan(155);
    }
  });
  it('keeps account-only tools and withdrawn TDS out', () => {
    const slugs = FREE_TOOLS.map((t) => t.slug);
    for (const s of ['todo', 'google-lead-extractor', 'whatsapp-group-extractor']) expect(slugs).not.toContain(s);
    expect(slugs.includes('tds-calculator')).toBe(TDS_PUBLIC);
    expect(getFreeTool('xyz')).toBeUndefined();
  });
  it('has clean public copy', () => {
    const text = JSON.stringify(FREE_TOOLS);
    expect(text).not.toMatch(/—|\bISO\b|SOC ?2|bank[- ]grade|military|100%|unhackable|guaranteed|\bbest\b|#1/i);
    expect(text).not.toMatch(/\b(12|28)\s?(%|per ?cent)/i);
  });
  it('marks the rate tools and names the outside model', () => {
    for (const s of ['gst-calculator', 'hsn-finder']) expect(getFreeTool(s)!.showsStatutoryRates).toBe(true);
    expect(getFreeTool('image-background-remover')!.notes).toMatch(/Google/);
    expect(getFreeTool('image-background-remover')!.notes).toMatch(/jsdelivr/);
    expect(getFreeTool('currency-converter')!.notes).toMatch(/Reference rates as of/);
  });
  it('final-review copy fixes', () => {
    const all = JSON.stringify(FREE_TOOLS);
    expect(all).not.toMatch(/print button/i);
    expect(all).not.toMatch(/30 MB/);
    const inv = JSON.stringify(getFreeTool('invoice-maker'));
    expect(inv.match(/use Download PDF, then choose Save as PDF in the print window/gi)?.length).toBe(2);
    expect(getFreeTool('image-background-remover')!.notes).toContain(
      'the MediaPipe library and its WebAssembly files come from cdn.jsdelivr.net, and the model from Google (storage.googleapis.com)',
    );
    const tds = getFreeTool('tds-calculator')!;
    expect(tds.faqs).toContainEqual({
      question: 'Why is insurance commission 2% when some charts show 5%?',
      answer: 'The Finance Act, 2026 sets 2% for a payee who is not a company. Some published charts still show the older 5%.',
    });
    const coin = getFreeTool('currency-converter')!;
    expect(coin.faqs.map((f) => f.answer).join(' ')).toMatch(/Reference rates as of \d{1,2} [A-Z][a-z]+ \d{4}\. Banks and money changers charge a different rate\./);
    expect(coin.notes).toMatch(/rbi\.org\.in|fbil\.org\.in/);
  });
  it('component copy says choose, not upload', () => {
    const bg = fs.readFileSync(path.join(process.cwd(), 'components/tools/ImageBackgroundRemoverTool.tsx'), 'utf8');
    expect(bg).toContain('Choose a product or portrait photo');
    expect(bg).not.toMatch(/>[^<]*upload/i);
    expect(bg).not.toMatch(/30 MB/);
    const rs = fs.readFileSync(path.join(process.cwd(), 'components/tools/ImageSizeReducerTool.tsx'), 'utf8');
    expect(rs).toContain('Lower quality makes JPG and WebP files smaller');
    expect(rs).not.toContain('Lower quality = smaller file');
    expect(rs).toContain('Most photo formats');
  });
  it('lists the hub and every tool page', () => {
    expect(FREE_TOOL_PATHS[0]).toBe('/free-tools');
    expect(FREE_TOOL_PATHS).toHaveLength(FREE_TOOLS.length + 1);
  });
  it('has a component in the registry for every tool except the invoice maker (Task 6)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'components/tools/registry.tsx'), 'utf8');
    for (const t of FREE_TOOLS) {
      if (t.slug === 'invoice-maker') continue;
      expect(src).toContain(`'${t.slug}'`);
    }
  });
});
