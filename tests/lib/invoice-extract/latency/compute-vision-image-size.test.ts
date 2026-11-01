import {
  computeInvoiceVisionTargetSize,
} from '@/lib/invoice-extract/latency/compute-vision-image-size';
import { INVOICE_VISION_MAX_LONG_SIDE } from '@/lib/invoice-extract/latency/constants';

describe('computeInvoiceVisionTargetSize', () => {
  it('does not upscale an already-small image', () => {
    expect(computeInvoiceVisionTargetSize(800, 600)).toEqual({
      width: 800,
      height: 600,
      scale: 1,
      resized: false,
    });
  });

  it('leaves an exact 1600 long-side image unchanged', () => {
    expect(computeInvoiceVisionTargetSize(1600, 900)).toEqual({
      width: 1600,
      height: 900,
      scale: 1,
      resized: false,
    });
  });

  it('downscales a large landscape Android photo so the long side is 1600', () => {
    const out = computeInvoiceVisionTargetSize(4032, 3024);
    expect(out.resized).toBe(true);
    expect(Math.max(out.width, out.height)).toBe(INVOICE_VISION_MAX_LONG_SIDE);
    expect(out.width).toBe(1600);
    expect(out.height).toBe(1200);
    expect(out.width / out.height).toBeCloseTo(4032 / 3024, 5);
  });

  it('downscales a large portrait image so the long side is 1600', () => {
    const out = computeInvoiceVisionTargetSize(3024, 4032);
    expect(out.resized).toBe(true);
    expect(out.width).toBe(1200);
    expect(out.height).toBe(1600);
  });

  it('keeps a long narrow image at 800px short side, never past 3200px long', () => {
    const out = computeInvoiceVisionTargetSize(8000, 2000);
    expect(out.width).toBe(3200);
    expect(out.height).toBe(800);
  });

  it('keeps a cropped till roll readable instead of shrinking it to 1600px tall', () => {
    // A receipt cropped from a 4000px photo: ~1100px wide, 3300px tall.
    const out = computeInvoiceVisionTargetSize(1100, 3300);
    expect(out.resized).toBe(true);
    expect(out.width).toBe(800);
    expect(out.height).toBe(2400);
  });

  it('leaves a narrow image that is already small enough alone', () => {
    expect(computeInvoiceVisionTargetSize(700, 2600).resized).toBe(false);
  });
});
