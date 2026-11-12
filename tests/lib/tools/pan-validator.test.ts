import { validatePan } from '@/lib/tools/pan-validator';

describe('PAN validator', () => {
  it('reads the holder type from the fourth character', () => {
    expect(validatePan('ABCPE1234F')).toMatchObject({ isValid: true, holderType: 'Individual' });
    expect(validatePan('AAACR5055K')).toMatchObject({ isValid: true, holderType: 'Company' });
  });

  it.each([
    ['AAAHA1234A', 'Hindu Undivided Family (HUF)'],
    ['AAAFA1234A', 'Firm'],
    ['AAAAA1234A', 'Association of Persons (AOP)'],
    ['AAATA1234A', 'Trust'],
    ['AAABA1234A', 'Body of Individuals (BOI)'],
    ['AAALA1234A', 'Local Authority'],
    ['AAAJA1234A', 'Artificial Juridical Person'],
    ['AAAGA1234A', 'Government'],
  ])('%s is %s', (pan, type) => {
    expect(validatePan(pan).holderType).toBe(type);
  });

  it('flags an unknown fourth character', () => {
    expect(validatePan('AAAZA1234A')).toMatchObject({ isValid: false });
  });

  it('cleans spaces and case', () => {
    expect(validatePan(' abcpe1234f ')).toMatchObject({ isValid: true, pan: 'ABCPE1234F' });
  });

  it('rejects bad format and empty input', () => {
    expect(validatePan('').isValid).toBe(false);
    expect(validatePan('ABCP1234EF').isValid).toBe(false);
  });
});
