import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { PRICING_HIDDEN_PLAN_IDS } from '@/lib/subscription/pricing-catalog';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/pricing-display
 * How features, limits and plans read on the public pricing section (migration 385).
 * Which plan has which feature is still edited in the per-plan feature matrix.
 */
export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;
  try {
    const [features, limits, plans] = await Promise.all([
      db.queryRows(
        `SELECT id, category, label, show_on_pricing, pricing_label, pricing_rank
         FROM platform_features WHERE is_active = true ORDER BY category, pricing_rank, sort_order`,
      ),
      db.queryRows(
        `SELECT limit_key, category, label, show_on_pricing, pricing_label_one, pricing_label_many, pricing_rank
         FROM platform_limits WHERE is_active = true ORDER BY show_on_pricing DESC, pricing_rank, sort_order`,
      ),
      db.queryRows(
        `SELECT id, display_name, product_line, pricing_badge FROM subscription_plans WHERE is_active = true ORDER BY sort_order`,
      ),
    ]);
    return NextResponse.json({
      features,
      limits,
      plans: plans.filter((p: { id: string }) => !PRICING_HIDDEN_PLAN_IDS.has(p.id)),
    });
  } catch (error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === '42703') {
      return NextResponse.json({ error: 'Run database migration 385 to edit the pricing page.' }, { status: 409 });
    }
    console.error('Error loading pricing display settings:', error);
    return NextResponse.json({ error: 'Failed to load pricing display settings' }, { status: 500 });
  }
}

type FeatureInput = { id: string; show_on_pricing: boolean; pricing_label: string | null; pricing_rank: number };
type LimitInput = {
  limit_key: string;
  show_on_pricing: boolean;
  pricing_label_one: string | null;
  pricing_label_many: string | null;
  pricing_rank: number;
};
type PlanInput = { id: string; pricing_badge: string | null };

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function cleanRank(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 9999) : 100;
}

/** PUT /api/admin/pricing-display — body { features?, limits?, plans? } with the rows to update. */
export async function PUT(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
  if (!auth.ok) return auth.response;

  let body: { features?: unknown; limits?: unknown; plans?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const features: FeatureInput[] = (Array.isArray(body.features) ? body.features : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { id?: unknown }).id === 'string')
    .map((f) => ({
      id: String(f.id),
      show_on_pricing: f.show_on_pricing === true,
      pricing_label: cleanText(f.pricing_label, 120),
      pricing_rank: cleanRank(f.pricing_rank),
    }));
  const limits: LimitInput[] = (Array.isArray(body.limits) ? body.limits : [])
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && typeof (l as { limit_key?: unknown }).limit_key === 'string')
    .map((l) => ({
      limit_key: String(l.limit_key),
      show_on_pricing: l.show_on_pricing === true,
      pricing_label_one: cleanText(l.pricing_label_one, 80),
      pricing_label_many: cleanText(l.pricing_label_many, 80),
      pricing_rank: cleanRank(l.pricing_rank),
    }));
  const plans: PlanInput[] = (Array.isArray(body.plans) ? body.plans : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string')
    .map((p) => ({ id: String(p.id), pricing_badge: cleanText(p.pricing_badge, 40) }));

  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    for (const f of features) {
      await client.query(
        `UPDATE platform_features
         SET show_on_pricing = $2, pricing_label = $3, pricing_rank = $4, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [f.id, f.show_on_pricing, f.pricing_label, f.pricing_rank],
      );
    }
    for (const l of limits) {
      await client.query(
        `UPDATE platform_limits
         SET show_on_pricing = $2, pricing_label_one = $3, pricing_label_many = $4, pricing_rank = $5,
             updated_at = CURRENT_TIMESTAMP
         WHERE limit_key = $1`,
        [l.limit_key, l.show_on_pricing, l.pricing_label_one, l.pricing_label_many, l.pricing_rank],
      );
    }
    for (const p of plans) {
      await client.query(`UPDATE subscription_plans SET pricing_badge = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [
        p.id,
        p.pricing_badge,
      ]);
    }
    await client.query('COMMIT');
    return NextResponse.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error saving pricing display settings:', error);
    return NextResponse.json({ error: 'Failed to save pricing display settings' }, { status: 500 });
  } finally {
    client.release();
  }
}
