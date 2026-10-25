import {
  parseRegistrationNumber,
  safeRegistrationFileName,
  sniffRegistrationFile,
} from '@/lib/business/registration-ids';

describe('parseRegistrationNumber', () => {
  it('accepts an Udyam number with or without hyphens and clears an empty value', () => {
    expect(parseRegistrationNumber('msme', 'udyam-ka-12-1234567')).toEqual({
      ok: true,
      value: 'UDYAM-KA-12-1234567',
    });
    expect(parseRegistrationNumber('msme', 'UDYAMKA121234567')).toEqual({
      ok: true,
      value: 'UDYAM-KA-12-1234567',
    });
    expect(parseRegistrationNumber('msme', '  ')).toEqual({ ok: true, value: null });
  });

  it('rejects an Udyam number, TAN, or DIN that does not match', () => {
    expect(parseRegistrationNumber('msme', 'MSME-123').ok).toBe(false);
    expect(parseRegistrationNumber('tan', 'BLRA1234B').ok).toBe(false);
    expect(parseRegistrationNumber('tan', 'blra12345b')).toEqual({ ok: true, value: 'BLRA12345B' });
    expect(parseRegistrationNumber('din', '1234567').ok).toBe(false);
    expect(parseRegistrationNumber('din', '00123456')).toEqual({ ok: true, value: '00123456' });
  });
});

describe('sniffRegistrationFile', () => {
  it('recognises pdf and images and rejects other bytes', () => {
    expect(sniffRegistrationFile(Buffer.from('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(sniffRegistrationFile(Buffer.from([0xff, 0xd8, 0xff, 0x00]))?.mime).toBe('image/jpeg');
    expect(sniffRegistrationFile(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe('image/png');
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    expect(sniffRegistrationFile(webp)?.mime).toBe('image/webp');
    expect(sniffRegistrationFile(Buffer.from('hello'))).toBeNull();
  });

  it('keeps a readable file name and drops a blank one', () => {
    expect(safeRegistrationFileName('Udyam cert.pdf', 'application/pdf')).toBe('Udyam cert.pdf');
    expect(safeRegistrationFileName('../secret', 'image/png')).toBe('secret');
    expect(safeRegistrationFileName('', 'image/jpeg')).toBe('certificate.jpg');
  });
});
