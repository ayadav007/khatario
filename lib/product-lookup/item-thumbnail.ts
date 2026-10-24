import sharp from 'sharp';

/**
 * Scan & Add Items: the front-of-pack photo, shrunk to an item picture. Saved in items.image_url as
 * a data URL, like pictures uploaded on the New Item form, but at about 30-60 KB instead of the
 * full camera photo, so a 300-product shop does not carry megabytes per item in every list.
 */
export const ITEM_THUMBNAIL_MAX_PX = 512;
const QUALITY = 72;

/** Null when the bytes are not a readable image. */
export async function makeItemThumbnail(image: Buffer): Promise<string | null> {
  try {
    const jpeg = await sharp(image, { failOn: 'none' })
      .rotate()
      .resize({ width: ITEM_THUMBNAIL_MAX_PX, height: ITEM_THUMBNAIL_MAX_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}
