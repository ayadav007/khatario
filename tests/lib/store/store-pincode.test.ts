import { deliveryCheckAnswer, deliveryCheckShown, pincodeToSave } from '@/lib/store/store-pincode';

const pins = ['560001', '560 002'];

describe('delivery check', () => {
  it('shows the check only for a branch with its own pincode list', () => {
    expect(deliveryCheckShown(undefined)).toBe(false);
    expect(deliveryCheckShown({ serviceable_pincodes: [], delivery_mode: 'pincode' })).toBe(false);
    expect(deliveryCheckShown({ serviceable_pincodes: pins, delivery_mode: 'all_india' })).toBe(false);
    expect(deliveryCheckShown({ serviceable_pincodes: pins, delivery_mode: 'pincode' })).toBe(true);
  });

  it('answers per pincode', () => {
    const branch = { serviceable_pincodes: pins, delivery_mode: 'pincode' as const };
    expect(deliveryCheckAnswer(branch, '5600')).toBeNull();
    expect(deliveryCheckAnswer(branch, '')).toBeNull();
    expect(deliveryCheckAnswer(branch, '560001')).toBe('Delivers to 560001');
    expect(deliveryCheckAnswer(branch, '560002')).toBe('Delivers to 560002');
    expect(deliveryCheckAnswer(branch, '400001')).toBe("We don't deliver to 400001 yet");
  });
});

describe('pincodeToSave', () => {
  it('saves only a full 6-digit pincode, cleaned', () => {
    expect(pincodeToSave('5600')).toBeNull();
    expect(pincodeToSave('')).toBeNull();
    expect(pincodeToSave('56 00 01')).toBe('560001');
    expect(pincodeToSave('560001')).toBe('560001');
  });
});
