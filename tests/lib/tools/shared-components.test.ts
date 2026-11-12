import fs from 'fs';
import path from 'path';

const TOOLS: [slug: string, component: string][] = [
  ['gst-calculator', 'GstCalculatorTool'], ['gstin-validator', 'GstinValidatorTool'], ['pan-validator', 'PanValidatorTool'],
  ['hsn-finder', 'HsnFinderTool'], ['tds-calculator', 'TdsCalculatorTool'], ['discount-calculator', 'DiscountCalculatorTool'],
  ['price-margin-calculator', 'PriceMarginCalculatorTool'], ['interest-calculator', 'InterestCalculatorTool'],
  ['emi-calculator', 'EmiCalculatorTool'], ['currency-converter', 'CurrencyConverterTool'],
  ['invoice-number-generator', 'InvoiceNumberGeneratorTool'], ['image-size-reducer', 'ImageSizeReducerTool'],
  ['image-background-remover', 'ImageBackgroundRemoverTool'],
];
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
it.each(TOOLS)('%s: in-app page renders the shared component', (slug, name) => {
  const page = read(`app/(app)/tools/${slug}/page.tsx`);
  expect(page).toContain(`from '@/components/tools/${name}'`);
  expect(page).toContain(`<${name} />`);
  expect(page).toContain('PageHeader');
});
it.each(TOOLS)('%s: shared component works signed out', (_slug, name) => {
  const src = read(`components/tools/${name}.tsx`);
  expect(src.startsWith("'use client'")).toBe(true);
  expect(src).toContain(`export function ${name}(`);
  expect(src).not.toMatch(/@\/components\/layout\/|@\/contexts\/|useAuth|useBusiness|fetch\(\s*['"`]\/api\//);
});
it('invoice maker sends nothing and saves only in this browser', () => {
  const src = read('components/tools/InvoiceMakerTool.tsx') + read('components/tools/InvoicePreview.tsx');
  expect(src).not.toMatch(/fetch\(|axios|XMLHttpRequest|navigator\.sendBeacon|@\/components\/layout\/|useAuth/);
  expect(src).toContain('INVOICE_DRAFT_KEY');
  expect(src).toMatch(/try\s*\{[^}]*localStorage/s);
  expect(src).toContain('window.print()');
  expect(read('components/tools/registry.tsx')).toContain("'invoice-maker'");
});
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
it('prints only the invoice, without touching other pages', () => {
  const css = stripComments(read('app/globals.css'));
  expect(css).toMatch(/@media print[\s\S]*\.free-invoice-print-area/);
  expect(css).toMatch(/body:has\(\.free-invoice-print-area\)[^{}]*\{[^}]*display:\s*none\s*!important/);
  expect(css).not.toMatch(/visibility:\s*hidden/);
  expect(css).not.toMatch(/position:\s*absolute\s*!important/);
});
it('globals.css has no @page rule (the invoice maker sets it while mounted)', () => {
  expect(stripComments(read('app/globals.css'))).not.toMatch(/@page/);
  expect(read('components/tools/InvoiceMakerTool.tsx')).toMatch(/@page\{size:A4/);
});
it('strips frames and gaps from the sheet\'s ancestors when printing', () => {
  const css = stripComments(read('app/globals.css'));
  const rule = css.match(/body:has\(\.free-invoice-print-area\)\s+:has\(\.free-invoice-print-area\)\s*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  const body = rule![1];
  for (const decl of ['margin: 0 !important', 'padding: 0 !important', 'border: 0 !important', 'box-shadow: none !important', 'background: none !important']) {
    expect(body).toContain(decl);
  }
  const printBlock = css.slice(css.lastIndexOf('@media print'));
  expect(printBlock).toContain(rule![0]);
});
it('public tool pages stay light on dark-mode devices', () => {
  expect(read('components/tools/FreeToolPageBody.tsx')).toContain('free-tool-light');
  const css = stripComments(read('app/globals.css'));
  expect(css).toMatch(/\.dark \.free-tool-light\s*\{[^}]*color-scheme:\s*light/);
  expect(css).toMatch(/\.dark \.free-tool-light \.card/);
  expect(css).toMatch(/\.dark \.free-tool-light \.input/);
});
