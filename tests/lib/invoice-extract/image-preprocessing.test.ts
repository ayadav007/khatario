import sharp from 'sharp';
import {
  preprocessInvoiceImage,
  getPreprocessProfile,
} from '@/lib/services/invoice-extract/imagePreprocessingService';

describe('imagePreprocessingService', () => {
  async function syntheticReceiptPng(): Promise<Buffer> {
    return sharp({
      create: {
        width: 400,
        height: 1200,
        channels: 3,
        background: { r: 250, g: 250, b: 250 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="360" height="1100"><text x="20" y="80" font-size="28" fill="black">GST TAX INVOICE</text><text x="20" y="200" font-size="22" fill="black">Item A  100.00</text><text x="20" y="280" font-size="22" fill="black">Total  100.00</text></svg>`
          ),
          top: 40,
          left: 20,
        },
      ])
      .png()
      .toBuffer();
  }

  it('exposes three production profiles', () => {
    expect(getPreprocessProfile('thermal_receipt').finalOutputMode).toBe('binary');
    expect(getPreprocessProfile('printed_invoice').finalOutputMode).toBe('grayscale');
    expect(getPreprocessProfile('handwritten_bill').finalOutputMode).toBe('grayscale_clahe');
  });

  it('sharp-only path returns PNG buffer', async () => {
    const input = await syntheticReceiptPng();
    const out = await preprocessInvoiceImage(input, {
      profile: 'printed_invoice',
      skipOpenCv: true,
    });
    expect(out.buffer.length).toBeGreaterThan(100);
    expect(out.mimeType).toBe('image/png');
    expect(out.width).toBeGreaterThan(0);
    expect(out.height).toBeGreaterThan(0);
    expect(out.stepsApplied).toContain('skip_opencv_grayscale_png');
  });

  const runOpenCvIntegration = process.env.RUN_OPENCV_TESTS === '1';

  (runOpenCvIntegration ? it : it.skip)(
    'full OpenCV pipeline produces OCR-sized PNG',
    async () => {
      const input = await syntheticReceiptPng();
      const out = await preprocessInvoiceImage(input, {
        profile: 'thermal_receipt',
        autoDetectProfile: false,
      });
      expect(out.buffer.subarray(0, 8).toString('hex')).toMatch(/^89504e47/);
      expect(out.profileId).toBe('thermal_receipt');
      expect(out.stepsApplied.length).toBeGreaterThan(2);
    },
    120_000
  );
});
