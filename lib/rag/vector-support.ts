import { queryOne } from '@/lib/db';

let cached: { value: boolean; at: number } | null = null;
const TTL_MS = 60_000;

/** True when pgvector is installed and kb_chunks.embedding exists (migration 300 adds it conditionally). */
export async function hasVectorColumn(): Promise<boolean> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const row = await queryOne<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'kb_chunks' AND column_name = 'embedding'
       ) AS ok`,
    );
    cached = { value: Boolean(row?.ok), at: Date.now() };
  } catch {
    cached = { value: false, at: Date.now() };
  }
  return cached.value;
}

export function resetVectorSupportCache(): void {
  cached = null;
}
