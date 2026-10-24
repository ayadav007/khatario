import fs from 'fs/promises';
import path from 'path';
import { query, queryOne, queryRows } from '@/lib/db';

export type SalesKitKind = 'link' | 'text' | 'file';

export type SalesKitItem = {
  id: string;
  title: string;
  description: string | null;
  kind: SalesKitKind;
  url: string | null;
  body_text: string | null;
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

function kitDir(): string {
  return (
    process.env.PARTNER_KIT_MEDIA_DIR?.trim() ||
    path.join(process.cwd(), 'storage', 'partner-kit')
  );
}

export async function listSalesKitItems(opts?: {
  activeOnly?: boolean;
}): Promise<SalesKitItem[]> {
  const where = opts?.activeOnly ? 'WHERE is_active = true' : '';
  return queryRows<SalesKitItem>(
    `SELECT id, title, description, kind, url, body_text, file_name, file_path,
            mime_type, size_bytes, sort_order, is_active, created_at
     FROM partner_sales_kit_items
     ${where}
     ORDER BY sort_order ASC, created_at DESC`,
  );
}

export async function createSalesKitItem(input: {
  title: string;
  description?: string | null;
  kind: SalesKitKind;
  url?: string | null;
  bodyText?: string | null;
  sortOrder?: number;
  adminId?: string | null;
  file?: { buffer: Buffer; fileName: string; mimeType: string };
}): Promise<SalesKitItem> {
  let fileName: string | null = null;
  let filePath: string | null = null;
  let mimeType: string | null = null;
  let sizeBytes: number | null = null;

  if (input.kind === 'file') {
    if (!input.file) throw new Error('File is required for kind=file');
    const dir = kitDir();
    await fs.mkdir(dir, { recursive: true });
    const safe = input.file.fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const stored = `${Date.now()}_${safe}`;
    const abs = path.join(dir, stored);
    await fs.writeFile(abs, input.file.buffer);
    fileName = input.file.fileName;
    filePath = stored;
    mimeType = input.file.mimeType;
    sizeBytes = input.file.buffer.length;
  }

  if (input.kind === 'link' && !input.url?.trim()) {
    throw new Error('url is required for kind=link');
  }
  if (input.kind === 'text' && !input.bodyText?.trim()) {
    throw new Error('body_text is required for kind=text');
  }

  const row = await queryOne<SalesKitItem>(
    `INSERT INTO partner_sales_kit_items (
       title, description, kind, url, body_text, file_name, file_path, mime_type,
       size_bytes, sort_order, is_active, created_by_admin_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
     RETURNING id, title, description, kind, url, body_text, file_name, file_path,
               mime_type, size_bytes, sort_order, is_active, created_at`,
    [
      input.title.trim(),
      input.description?.trim() || null,
      input.kind,
      input.url?.trim() || null,
      input.bodyText?.trim() || null,
      fileName,
      filePath,
      mimeType,
      sizeBytes,
      input.sortOrder ?? 0,
      input.adminId ?? null,
    ],
  );
  if (!row) throw new Error('Failed to create kit item');
  return row;
}

export async function updateSalesKitItem(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    url: string | null;
    bodyText: string | null;
    sortOrder: number;
    isActive: boolean;
  }>,
): Promise<SalesKitItem | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.title !== undefined) {
    sets.push(`title = $${i++}`);
    values.push(patch.title.trim());
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(patch.description);
  }
  if (patch.url !== undefined) {
    sets.push(`url = $${i++}`);
    values.push(patch.url);
  }
  if (patch.bodyText !== undefined) {
    sets.push(`body_text = $${i++}`);
    values.push(patch.bodyText);
  }
  if (patch.sortOrder !== undefined) {
    sets.push(`sort_order = $${i++}`);
    values.push(patch.sortOrder);
  }
  if (patch.isActive !== undefined) {
    sets.push(`is_active = $${i++}`);
    values.push(patch.isActive);
  }
  if (!sets.length) return queryOne(`SELECT * FROM partner_sales_kit_items WHERE id = $1`, [id]);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  return queryOne<SalesKitItem>(
    `UPDATE partner_sales_kit_items SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, title, description, kind, url, body_text, file_name, file_path,
               mime_type, size_bytes, sort_order, is_active, created_at`,
    values,
  );
}

export async function deleteSalesKitItem(id: string): Promise<boolean> {
  const row = await queryOne<{ file_path: string | null }>(
    `DELETE FROM partner_sales_kit_items WHERE id = $1 RETURNING file_path`,
    [id],
  );
  if (!row) return false;
  if (row.file_path) {
    await fs.unlink(path.join(kitDir(), row.file_path)).catch(() => undefined);
  }
  return true;
}

export async function resolveSalesKitFile(
  id: string,
): Promise<{ absPath: string; fileName: string; mimeType: string } | null> {
  const row = await queryOne<{
    file_path: string | null;
    file_name: string | null;
    mime_type: string | null;
    is_active: boolean;
    kind: string;
  }>(
    `SELECT file_path, file_name, mime_type, is_active, kind
     FROM partner_sales_kit_items WHERE id = $1`,
    [id],
  );
  if (!row || row.kind !== 'file' || !row.file_path || !row.is_active) return null;
  return {
    absPath: path.join(kitDir(), row.file_path),
    fileName: row.file_name || 'download',
    mimeType: row.mime_type || 'application/octet-stream',
  };
}
