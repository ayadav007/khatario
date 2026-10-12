import type { MarketingBrief } from '@/lib/marketing/brief';
import type { MarketingImageStyle } from '@/lib/marketing/image-style';

export type WorkerCopy = { headline: string; caption: string };

function workerConfig(): { url: string; secret: string } | null {
  const url = process.env.CLOUDFLARE_MARKETING_WORKER_URL?.trim().replace(/\/$/, '') || '';
  const secret = process.env.CLOUDFLARE_MARKETING_WORKER_SECRET?.trim() || '';
  if (!url || !secret) return null;
  return { url, secret };
}

async function workerFetch(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const config = workerConfig();
  if (!config) throw new Error('CLOUDFLARE_MARKETING_UNCONFIGURED');
  return fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function marketingWorkerConfigured(): boolean {
  return workerConfig() !== null;
}

export async function writeCopyWithWorker(brief: MarketingBrief, angle: string): Promise<WorkerCopy> {
  const response = await workerFetch(
    '/copy',
    {
      audience: brief.audience,
      offer: brief.offer,
      angle,
      bannedClaims: brief.bannedClaims,
    },
    20_000,
  );
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Cloudflare copy ${response.status}: ${detail.slice(0, 180)}`);
  }
  const data = (await response.json()) as { headline?: string; caption?: string };
  const headline = data.headline?.trim() || '';
  const caption = data.caption?.trim() || '';
  if (!headline || !caption) throw new Error('Cloudflare copy was empty');
  return { headline: headline.slice(0, 80), caption: caption.slice(0, 500) };
}

export async function renderImageWithWorker(input: {
  style: MarketingImageStyle;
  headline: string;
  angle: string;
  offer: string;
}): Promise<Buffer> {
  const response = await workerFetch('/image', input, 55_000);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Cloudflare image ${response.status}: ${detail.slice(0, 180)}`);
  }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('image/')) throw new Error('Cloudflare image was not a picture');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 32) throw new Error('Cloudflare image was empty');
  return bytes;
}
