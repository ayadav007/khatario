import sharp from 'sharp';
import { emptyScanAddForm, scanAddItemPayload } from '@/lib/items/scan-add-form';
import { hasUnfinishedProduct } from '@/lib/items/scan-add-draft';
import { ITEM_THUMBNAIL_MAX_PX, makeItemThumbnail } from '@/lib/product-lookup/item-thumbnail';

describe('prices include GST on Scan & Add', () => {
  test('starts from the business setting and is sent as gst_included', () => {
    expect(emptyScanAddForm('1').prices_include_gst).toBe(false);
    expect(emptyScanAddForm('1', true).prices_include_gst).toBe(true);
    const form = { ...emptyScanAddForm('1', true), name: 'Maggi 70 g' };
    expect(scanAddItemPayload(form).gst_included).toBe(true);
    expect(scanAddItemPayload({ ...form, prices_include_gst: false }).gst_included).toBe(false);
  });
});

describe('item picture from the front photo', () => {
  test('sent as image_url only when there is one', () => {
    const form = { ...emptyScanAddForm('1'), name: 'Maggi 70 g' };
    expect(scanAddItemPayload(form).image_url).toBeUndefined();
    expect(scanAddItemPayload({ ...form, image_url: 'data:image/jpeg;base64,AAAA' }).image_url).toBe('data:image/jpeg;base64,AAAA');
  });

  test('a product with only a photo is still offered back from the draft', () => {
    const current = { barcode: '', form: { ...emptyScanAddForm(''), image_url: 'data:image/jpeg;base64,AAAA' }, idempotencyKey: 'k', lookupSource: null, usedPhoto: true };
    expect(hasUnfinishedProduct(current)).toBe(true);
  });

  test('a camera-sized photo becomes a small JPEG within 512 px', async () => {
    const photo = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .png()
      .toBuffer();
    const thumb = await makeItemThumbnail(photo);
    expect(thumb).toMatch(/^data:image\/jpeg;base64,/);
    const bytes = Buffer.from(thumb!.split(',')[1], 'base64');
    const meta = await sharp(bytes).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(ITEM_THUMBNAIL_MAX_PX);
    expect(bytes.length).toBeLessThan(60_000);
  });

  test('bytes that are not an image give no picture', async () => {
    expect(await makeItemThumbnail(Buffer.from('not an image'))).toBeNull();
  });
});
