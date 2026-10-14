import { normalizeFeatureKey } from '@/lib/featureKeys';
import { resolveRegistryFeatureId } from '@/lib/subscription/feature-access';

describe('feature alias parity', () => {
  it('resolves pos_mode to the matrix row the browser already uses', () => {
    expect(normalizeFeatureKey('pos_mode')).toBe('settings_pos_mode');
    expect(resolveRegistryFeatureId('pos_mode')).toBe('settings_pos_mode');
  });

  it('resolves debit_notes to the sales matrix row', () => {
    expect(resolveRegistryFeatureId('debit_notes')).toBe('sales_debit_notes');
  });
});
