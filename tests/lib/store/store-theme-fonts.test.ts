import { STORE_FONT_FAMILIES, storeFontStack } from '@/lib/store/store-theme';

it('lists the six new families', () => {
  for (const f of ['cinzel', 'newsreader', 'manrope', 'dm-serif', 'lora', 'poppins']) expect(STORE_FONT_FAMILIES).toContain(f);
});

it('maps each new family to its variable with the right fallback', () => {
  expect(storeFontStack('cinzel')).toBe('var(--font-store-cinzel), Georgia, serif');
  expect(storeFontStack('manrope')).toBe('var(--font-store-manrope), system-ui, sans-serif');
  expect(storeFontStack('dm-serif')).toBe('var(--font-store-dm-serif), Georgia, serif');
});

it('lists anton and space-grotesk', () => {
  expect(STORE_FONT_FAMILIES).toContain('anton');
  expect(STORE_FONT_FAMILIES).toContain('space-grotesk');
});

it('maps them to their variables', () => {
  expect(storeFontStack('anton')).toBe('var(--font-store-anton), Impact, sans-serif');
  expect(storeFontStack('space-grotesk')).toBe('var(--font-store-space-grotesk), system-ui, sans-serif');
});

it('lists baloo and maps it to its variable', () => {
  expect(STORE_FONT_FAMILIES).toContain('baloo');
  expect(storeFontStack('baloo')).toBe('var(--font-store-baloo), system-ui, sans-serif');
});
