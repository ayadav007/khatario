import { promises as fs } from 'fs';
import path from 'path';
import { query, queryOne, queryRows } from '@/lib/db';
import { uploadMedia, uploadTemplateHeaderSample, WA_LIMITS, type MediaRef } from '@/lib/meta-whatsapp';
import { BUILTIN_MEDIA } from './default-flow';

/** Meta keeps uploaded media for 30 days; re-upload a day early. */
const META_MEDIA_TTL_MS = 29 * 24 * 60 * 60 * 1000;

export const ALLOWED_MEDIA: Record<'image' | 'video', { mimes: string[]; maxBytes: number }> = {
  image: { mimes: ['image/jpeg', 'image/png'], maxBytes: WA_LIMITS.imageBytes },
  video: { mimes: ['video/mp4'], maxBytes: WA_LIMITS.videoBytes },
};

export type FlowMediaRow = {
  key: string;
  kind: 'image' | 'video';
  label: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  meta_media_id: string | null;
  meta_uploaded_at: string | Date | null;
  header_handle: string | null;
  updated_at?: string | Date;
};

export type FlowMediaInfo = {
  key: string;
  kind: 'image' | 'video';
  label: string;
  mimeType: string;
  sizeBytes: number;
  builtin: boolean;
  uploaded: boolean;
  previewUrl: string;
};

export function mediaDir(): string {
  return process.env.SALES_FLOW_MEDIA_DIR?.trim() || path.join(process.cwd(), 'storage', 'sales-flow');
}

const KEY_RE = /^[a-z0-9_]{1,64}$/;

export function isValidMediaKey(key: string): boolean {
  return KEY_RE.test(key);
}

function builtinRow(key: string): FlowMediaRow | null {
  const b = BUILTIN_MEDIA[key];
  if (!b) return null;
  return {
    key,
    kind: b.kind,
    label: b.label,
    storage_path: `builtin:${b.path}`,
    mime_type: b.mime,
    size_bytes: 0,
    meta_media_id: null,
    meta_uploaded_at: null,
    header_handle: null,
  };
}

export async function getMediaRow(key: string): Promise<FlowMediaRow | null> {
  if (!isValidMediaKey(key)) return null;
  const row = await queryOne<FlowMediaRow>(`SELECT * FROM sales_flow_media WHERE key = $1`, [key]).catch(() => null);
  return row ?? builtinRow(key);
}

export async function mediaExists(key: string): Promise<boolean> {
  return (await getMediaRow(key)) != null;
}

function resolvePath(storagePath: string): string {
  if (storagePath.startsWith('builtin:')) {
    const rel = storagePath.slice('builtin:'.length);
    const full = path.resolve(process.cwd(), rel);
    if (!full.startsWith(path.resolve(process.cwd(), 'public'))) throw new Error('Invalid built-in media path');
    return full;
  }
  const full = path.resolve(mediaDir(), storagePath);
  if (!full.startsWith(path.resolve(mediaDir()))) throw new Error('Invalid media path');
  return full;
}

export async function readMediaBuffer(row: FlowMediaRow): Promise<Buffer> {
  return fs.readFile(resolvePath(row.storage_path));
}

/** Built-in media gets a row the first time it is uploaded to Meta, so the media id is reused. */
async function persistMetaIds(row: FlowMediaRow, fields: { meta_media_id?: string; header_handle?: string }) {
  await query(
    `INSERT INTO sales_flow_media (key, kind, label, storage_path, mime_type, size_bytes, meta_media_id, meta_uploaded_at, header_handle)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE NOW() END, $8)
     ON CONFLICT (key) DO UPDATE SET
       meta_media_id = COALESCE($7, sales_flow_media.meta_media_id),
       meta_uploaded_at = CASE WHEN $7::text IS NULL THEN sales_flow_media.meta_uploaded_at ELSE NOW() END,
       header_handle = COALESCE($8, sales_flow_media.header_handle),
       updated_at = NOW()`,
    [
      row.key,
      row.kind,
      row.label,
      row.storage_path,
      row.mime_type,
      row.size_bytes,
      fields.meta_media_id ?? null,
      fields.header_handle ?? null,
    ],
  );
}

/** Media id for sending (uploads to Meta when missing or near expiry); null when no such media. */
export async function mediaRefForSend(key: string): Promise<MediaRef | null> {
  const row = await getMediaRow(key);
  if (!row) return null;
  const uploadedAt = row.meta_uploaded_at ? new Date(row.meta_uploaded_at).getTime() : 0;
  if (row.meta_media_id && Date.now() - uploadedAt < META_MEDIA_TTL_MS) return { id: row.meta_media_id };
  const buffer = await readMediaBuffer(row);
  const ext = row.mime_type.split('/')[1] || 'bin';
  const id = await uploadMedia({
    buffer,
    mimeType: row.mime_type,
    filename: `${row.key}.${ext}`,
    timeoutMs: row.kind === 'video' ? 120_000 : 30_000,
  });
  await persistMetaIds(row, { meta_media_id: id });
  return { id };
}

/** Sample handle for an IMAGE/VIDEO template header; uploaded once per media version. */
export async function ensureHeaderHandle(key: string): Promise<string> {
  const row = await getMediaRow(key);
  if (!row) throw new Error(`Media "${key}" not found; upload it in Admin > Sales flow > Media`);
  if (row.header_handle) return row.header_handle;
  const buffer = await readMediaBuffer(row);
  const handle = await uploadTemplateHeaderSample({ buffer, mimeType: row.mime_type });
  await persistMetaIds(row, { header_handle: handle });
  return handle;
}

export class MediaValidationError extends Error {}

export async function saveUploadedMedia(input: {
  key: string;
  kind: 'image' | 'video';
  label?: string | null;
  buffer: Buffer;
  mimeType: string;
}): Promise<FlowMediaInfo> {
  if (!isValidMediaKey(input.key)) throw new MediaValidationError('Key must use lowercase letters, numbers and underscores');
  const rules = ALLOWED_MEDIA[input.kind];
  if (!rules) throw new MediaValidationError('Unsupported media kind');
  if (!rules.mimes.includes(input.mimeType)) {
    throw new MediaValidationError(input.kind === 'video' ? 'Video must be an MP4 file' : 'Image must be JPG or PNG');
  }
  if (input.buffer.length === 0) throw new MediaValidationError('File is empty');
  if (input.buffer.length > rules.maxBytes) {
    throw new MediaValidationError(
      `File is ${(input.buffer.length / 1024 / 1024).toFixed(1)} MB; WhatsApp allows up to ${rules.maxBytes / 1024 / 1024} MB`,
    );
  }
  const ext = input.mimeType === 'video/mp4' ? 'mp4' : input.mimeType === 'image/png' ? 'png' : 'jpg';
  const fileName = `${input.key}-${Date.now()}.${ext}`;
  await fs.mkdir(mediaDir(), { recursive: true });
  await fs.writeFile(path.join(mediaDir(), fileName), input.buffer);

  const previous = await queryOne<{ storage_path: string }>(`SELECT storage_path FROM sales_flow_media WHERE key = $1`, [input.key]).catch(() => null);
  await query(
    `INSERT INTO sales_flow_media (key, kind, label, storage_path, mime_type, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (key) DO UPDATE SET
       kind = EXCLUDED.kind, label = COALESCE(EXCLUDED.label, sales_flow_media.label),
       storage_path = EXCLUDED.storage_path, mime_type = EXCLUDED.mime_type, size_bytes = EXCLUDED.size_bytes,
       meta_media_id = NULL, meta_uploaded_at = NULL, header_handle = NULL, updated_at = NOW()`,
    [input.key, input.kind, input.label?.trim() || null, fileName, input.mimeType, input.buffer.length],
  );
  if (previous?.storage_path && !previous.storage_path.startsWith('builtin:')) {
    await fs.unlink(resolvePath(previous.storage_path)).catch(() => undefined);
  }
  // Templates using this media need a fresh sample handle on their next submit.
  await query(`UPDATE platform_whatsapp_templates SET header_handle = NULL WHERE header_media_key = $1 AND status IN ('draft', 'rejected')`, [input.key]).catch(() => undefined);

  return {
    key: input.key,
    kind: input.kind,
    label: input.label?.trim() || input.key,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    builtin: false,
    uploaded: true,
    previewUrl: `/api/admin/sales-flow/media/${input.key}`,
  };
}

export async function deleteMedia(key: string): Promise<boolean> {
  const row = await queryOne<{ storage_path: string }>(`DELETE FROM sales_flow_media WHERE key = $1 RETURNING storage_path`, [key]);
  if (!row) return false;
  if (!row.storage_path.startsWith('builtin:')) await fs.unlink(resolvePath(row.storage_path)).catch(() => undefined);
  return true;
}

export async function listMedia(): Promise<FlowMediaInfo[]> {
  const rows = await queryRows<FlowMediaRow>(`SELECT * FROM sales_flow_media ORDER BY key`).catch(() => [] as FlowMediaRow[]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const out: FlowMediaInfo[] = [];
  for (const r of rows) {
    const builtin = r.storage_path.startsWith('builtin:');
    out.push({
      key: r.key,
      kind: r.kind,
      label: r.label || BUILTIN_MEDIA[r.key]?.label || r.key,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes) || 0,
      builtin,
      uploaded: !builtin,
      previewUrl: `/api/admin/sales-flow/media/${r.key}`,
    });
  }
  for (const [key, b] of Object.entries(BUILTIN_MEDIA)) {
    if (byKey.has(key)) continue;
    out.push({ key, kind: b.kind, label: b.label, mimeType: b.mime, sizeBytes: 0, builtin: true, uploaded: false, previewUrl: `/api/admin/sales-flow/media/${key}` });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
