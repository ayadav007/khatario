import { queryOne } from '@/lib/db';

let cached: Promise<boolean> | null = null;

/** True once migration 334 has added accounts.pl_section. Only a positive answer is cached. */
export function hasPlSectionColumn(): Promise<boolean> {
  if (!cached) {
    cached = queryOne<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'accounts' AND column_name = 'pl_section'
       ) AS ok`
    ).then((r) => {
      if (!r?.ok) cached = null;
      return !!r?.ok;
    }, (e) => {
      cached = null;
      throw e;
    });
  }
  return cached;
}
