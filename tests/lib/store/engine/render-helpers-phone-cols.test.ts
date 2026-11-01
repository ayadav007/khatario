import { phoneColumnsClass } from '@/lib/store/engine/render-helpers';
import { sanitizeSection } from '@/lib/store/engine/sanitize';
import { getSectionSchema } from '@/lib/store/engine/registry';

describe('Columns on phone', () => {
  it('maps the setting to a grid class, and nothing for the theme default', () => {
    expect(phoneColumnsClass('2')).toBe('mcols-2');
    expect(phoneColumnsClass('3')).toBe('mcols-3');
    expect(phoneColumnsClass('auto')).toBeUndefined();
    expect(phoneColumnsClass(undefined)).toBeUndefined();
    expect(phoneColumnsClass('4')).toBeUndefined();
  });

  it('is a setting on featured products only, not on product rails', () => {
    const ids = (type: string) => getSectionSchema(type)!.settings.map((s) => s.id);
    expect(ids('featured-products')).toContain('mobile_columns');
    expect(ids('product-rail')).not.toContain('mobile_columns');
  });

  it('keeps 2 or 3 through the sanitizer and resets anything else to the theme default', () => {
    const sec = (v: unknown) =>
      sanitizeSection({ type: 'featured-products', settings: { mobile_columns: v }, blocks: {}, block_order: [] }, 'home');
    expect(sec('3')?.settings.mobile_columns).toBe('3');
    expect(sec('7')?.settings.mobile_columns ?? 'auto').toBe('auto');
  });
});
