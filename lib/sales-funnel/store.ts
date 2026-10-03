import { getPool, queryOne, queryRows } from '@/lib/db';
import { DEFAULT_FLOW } from './default-flow';
import { validateFlow, type FlowDefinition } from './definition';

export type PublishedFlow = { version: number; flow: FlowDefinition };

export type FlowVersionSummary = {
  version: number;
  status: 'draft' | 'published' | 'archived';
  note: string | null;
  published_at: string | null;
  updated_at: string;
};

const CACHE_MS = 30_000;
let cache: { at: number; value: PublishedFlow } | null = null;

export function clearFlowCache() {
  cache = null;
}

/** Version 1 is the built-in default flow, published the first time the funnel runs. */
async function seedDefault(): Promise<PublishedFlow> {
  await queryOne(
    `INSERT INTO sales_flow_versions (version, status, definition, note, published_at)
     VALUES (1, 'published', $1::jsonb, 'Default flow', NOW())
     ON CONFLICT (version) DO NOTHING
     RETURNING id`,
    [JSON.stringify(DEFAULT_FLOW)],
  );
  const row = await queryOne<{ version: number; definition: unknown }>(
    `SELECT version, definition FROM sales_flow_versions WHERE status = 'published' LIMIT 1`,
  );
  const parsed = row ? validateFlow(row.definition) : null;
  return parsed?.ok && row ? { version: row.version, flow: parsed.flow } : { version: 1, flow: DEFAULT_FLOW };
}

export async function getPublishedFlow(): Promise<PublishedFlow> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: PublishedFlow;
  try {
    const row = await queryOne<{ version: number; definition: unknown }>(
      `SELECT version, definition FROM sales_flow_versions WHERE status = 'published' LIMIT 1`,
    );
    if (!row) {
      value = await seedDefault();
    } else {
      const parsed = validateFlow(row.definition);
      value = parsed.ok ? { version: row.version, flow: parsed.flow } : { version: row.version, flow: DEFAULT_FLOW };
      if (!parsed.ok) console.error('[sales-funnel] published flow is invalid, using default:', parsed.errors.join('; '));
    }
  } catch (err) {
    console.error('[sales-funnel] could not load flow:', err instanceof Error ? err.message : err);
    value = { version: 0, flow: DEFAULT_FLOW };
  }
  cache = { at: Date.now(), value };
  return value;
}

/** The draft being edited; created from the published flow when there is none. */
export async function getDraft(): Promise<{ version: number; flow: FlowDefinition; updated_at: string }> {
  const draft = await queryOne<{ version: number; definition: unknown; updated_at: string }>(
    `SELECT version, definition, updated_at FROM sales_flow_versions WHERE status = 'draft' LIMIT 1`,
  );
  if (draft) {
    const parsed = validateFlow(draft.definition);
    return { version: draft.version, flow: parsed.ok ? parsed.flow : (draft.definition as FlowDefinition), updated_at: draft.updated_at };
  }
  const published = await getPublishedFlow();
  const row = await queryOne<{ version: number; updated_at: string }>(
    `INSERT INTO sales_flow_versions (version, status, definition)
     VALUES ((SELECT COALESCE(MAX(version), 0) + 1 FROM sales_flow_versions), 'draft', $1::jsonb)
     RETURNING version, updated_at`,
    [JSON.stringify(published.flow)],
  );
  if (!row) throw new Error('Could not create draft');
  return { version: row.version, flow: published.flow, updated_at: row.updated_at };
}

export async function saveDraft(raw: unknown, adminId: string | null): Promise<{ ok: true; version: number } | { ok: false; errors: string[] }> {
  const parsed = validateFlow(raw);
  if (!parsed.ok) return parsed;
  const draft = await getDraft();
  await queryOne(
    `UPDATE sales_flow_versions SET definition = $2::jsonb, created_by = COALESCE(created_by, $3), updated_at = NOW()
      WHERE version = $1 AND status = 'draft' RETURNING id`,
    [draft.version, JSON.stringify(parsed.flow), adminId],
  );
  return { ok: true, version: draft.version };
}

export async function publishDraft(adminId: string | null, note?: string | null): Promise<{ ok: true; version: number } | { ok: false; errors: string[] }> {
  const draft = await getDraft();
  const parsed = validateFlow(draft.flow);
  if (!parsed.ok) return parsed;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE sales_flow_versions SET status = 'archived', updated_at = NOW() WHERE status = 'published'`);
    await client.query(
      `UPDATE sales_flow_versions SET status = 'published', published_at = NOW(), published_by = $2, note = COALESCE($3, note), updated_at = NOW()
        WHERE version = $1`,
      [draft.version, adminId, note?.trim() || null],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  clearFlowCache();
  return { ok: true, version: draft.version };
}

export async function discardDraft(): Promise<void> {
  await queryOne(`DELETE FROM sales_flow_versions WHERE status = 'draft' RETURNING id`);
}

/** Copy an older version into the draft so it can be reviewed and published again. */
export async function restoreVersion(version: number, adminId: string | null): Promise<{ ok: true; version: number } | { ok: false; errors: string[] }> {
  const row = await queryOne<{ definition: unknown }>(`SELECT definition FROM sales_flow_versions WHERE version = $1`, [version]);
  if (!row) return { ok: false, errors: ['Version not found'] };
  return saveDraft(row.definition, adminId);
}

export async function listVersions(): Promise<FlowVersionSummary[]> {
  return queryRows<FlowVersionSummary>(
    `SELECT version, status, note, published_at, updated_at FROM sales_flow_versions ORDER BY version DESC LIMIT 50`,
  );
}
