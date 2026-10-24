import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import sharp from 'sharp';
import { renderImageWithWorker } from '@/lib/marketing/cloudflare-worker';
import type { MarketingImageStyle } from '@/lib/marketing/image-style';

export const CREATIVE_URL_PREFIX = '/media/marketing-creatives/';
const FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

export function getCreativeDir(): string {
  const configured = process.env.MARKETING_CREATIVE_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(process.cwd(), 'storage', 'marketing-creatives');
}

export function creativeFileName(imagePath: string): string {
  const name = imagePath.split('/').pop() || '';
  if (!FILE_RE.test(name)) throw new Error('Invalid creative path');
  return name;
}

export async function readCreative(imagePath: string): Promise<Buffer> {
  const name = creativeFileName(imagePath);
  return fs.readFile(path.join(getCreativeDir(), name));
}

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapHeadline(headline: string): string[] {
  const words = headline.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > 28 && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && current) lines.push(current);
  return lines.slice(0, 2).map((line) => line.slice(0, 42));
}

function brandSvg(width: number, height: number, headline: string, paintHeadline: boolean): Buffer {
  const lines = wrapHeadline(headline || 'Khatario');
  const text = paintHeadline
    ? lines
        .map(
          (line, index) =>
            `<text x="72" y="${height - 220 + index * 68}" font-family="DejaVu Sans, Arial, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${xml(line)}</text>`,
        )
        .join('')
    : '';
  const scrim = paintHeadline
    ? `<rect x="0" y="${height - 280}" width="${width}" height="280" fill="#0f766e" fill-opacity="0.88"/>`
    : `<rect x="0" y="${height - 88}" width="${width}" height="88" fill="#0f766e"/>`;
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${scrim}
      ${text}
      <text x="72" y="${height - 36}" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">Khatario</text>
    </svg>`,
  );
}

async function saveCreative(bytes: Buffer): Promise<{ imagePath: string; bytes: Buffer }> {
  const name = `${randomUUID()}.png`;
  const dir = getCreativeDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), bytes);
  return { imagePath: `${CREATIVE_URL_PREFIX}${name}`, bytes };
}

async function composePhoto(source: Buffer, headline: string, style: MarketingImageStyle): Promise<Buffer> {
  const width = 1080;
  const height = style === 'poster' ? 1350 : 1080;
  const base = await sharp(source).resize(width, height, { fit: 'cover', position: 'centre' }).png().toBuffer();
  const overlay = brandSvg(width, height, headline, style === 'square');
  return sharp(base).composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
}

export async function renderCreative(
  headline: string,
  style: MarketingImageStyle = 'square',
  scene?: { angle?: string; offer?: string },
): Promise<{ imagePath: string; bytes: Buffer }> {
  try {
    const generated = await renderImageWithWorker({
      style,
      headline,
      angle: scene?.angle || '',
      offer: scene?.offer || '',
    });
    return saveCreative(await composePhoto(generated, headline, style));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message !== 'CLOUDFLARE_MARKETING_UNCONFIGURED') {
      console.warn('[marketing-creative] cloudflare skipped:', message.slice(0, 200));
    }
  }

  const height = style === 'poster' ? 1350 : 1080;
  const lines = wrapHeadline(headline || 'Khatario');
  const text = lines
    .map(
      (line, index) =>
        `<text x="72" y="${150 + index * 68}" font-family="DejaVu Sans, Arial, sans-serif" font-size="52" font-weight="700" fill="#ffffff">${xml(line)}</text>`,
    )
    .join('');
  const svg = Buffer.from(
    `<svg width="1080" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="1080" height="${height}" fill="#0f766e"/>
      <rect x="48" y="48" width="984" height="${height - 96}" rx="36" fill="#115e59"/>
      ${text}
      <text x="72" y="340" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" fill="#ccfbf1">GST billing for shopkeepers</text>
      <rect x="72" y="${height - 180}" width="220" height="64" rx="32" fill="#ffffff"/>
      <text x="112" y="${height - 138}" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" font-weight="700" fill="#0f766e">Khatario</text>
    </svg>`,
  );

  let image = sharp(svg).png();
  const shotPath = path.join(process.cwd(), 'public', 'marketing', 'screens', 'dashboard.png');
  try {
    const shot = await sharp(shotPath)
      .resize(860, 460, { fit: 'cover' })
      .png()
      .toBuffer();
    image = sharp(await image.toBuffer()).composite([{ input: shot, top: style === 'poster' ? 520 : 400, left: 110 }]);
  } catch {
    // Screenshot is optional. The wordmark still ships.
  }

  return saveCreative(await image.png().toBuffer());
}
