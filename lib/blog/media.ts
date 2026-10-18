import { detectImageType, MEDIA_MAX_UPLOAD_BYTES, storeMarketingImage } from '@/lib/marketing-builder/media';
import { upsertBlogMedia, type BlogMedia } from '@/lib/blog/repo';
import { BlogInputError } from '@/lib/blog/validate';

export async function storeBlogImage(buffer: Buffer, alt: string, adminId: string): Promise<BlogMedia> {
  if (buffer.length > MEDIA_MAX_UPLOAD_BYTES) {
    throw new BlogInputError('Image is larger than 8 MB', 413);
  }
  if (!detectImageType(buffer)) {
    throw new BlogInputError('Only JPEG, PNG, WebP or AVIF images are allowed', 415);
  }
  const altText = alt.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!altText) throw new BlogInputError('Add a short description (alt text) for this image');
  const stored = await storeMarketingImage(buffer);
  return upsertBlogMedia({
    url: stored.url,
    alt: altText,
    width: stored.width,
    height: stored.height,
    bytes: stored.bytes,
    adminId,
  });
}
