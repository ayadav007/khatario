import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, query } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/online-store/delivery?business_id=...
 * Returns per-branch delivery zone configs with charge tiers.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const zones = await queryRows<{
    id: string;
    branch_id: string;
    branch_name: string;
    location_lat: string | null;
    location_lng: string | null;
    location_address: string | null;
    delivery_mode: string;
    delivery_radius_km: number;
    serviceable_pincodes: string[];
    allow_pickup: boolean;
    is_active: boolean;
  }>(
    `SELECT
       sbd.id, sbd.branch_id, br.name AS branch_name,
       sbd.location_lat::text, sbd.location_lng::text, sbd.location_address,
       sbd.delivery_mode, sbd.delivery_radius_km,
       sbd.serviceable_pincodes, sbd.allow_pickup, sbd.is_active
     FROM store_branch_delivery sbd
     INNER JOIN branches br ON br.id = sbd.branch_id
     WHERE sbd.business_id = $1
     ORDER BY br.name`,
    [businessId],
  );

  // Fetch charges for each zone
  const result = await Promise.all(
    zones.map(async (z) => {
      const charges = await queryRows<{
        id: string;
        min_distance_km: number;
        max_distance_km: number | null;
        charge: string;
        free_above_amount: string | null;
        sort_order: number;
      }>(
        `SELECT id, min_distance_km, max_distance_km, charge::text, free_above_amount::text, sort_order
         FROM store_delivery_charges
         WHERE branch_delivery_id = $1
         ORDER BY sort_order`,
        [z.id],
      );

      return {
        ...z,
        location_lat: z.location_lat ? parseFloat(z.location_lat) : null,
        location_lng: z.location_lng ? parseFloat(z.location_lng) : null,
        charges: charges.map((c) => ({
          ...c,
          charge: parseFloat(c.charge) || 0,
          free_above_amount: c.free_above_amount ? parseFloat(c.free_above_amount) : null,
        })),
      };
    }),
  );

  // Also fetch all branches for the business (to show un-configured ones)
  const allBranches = await queryRows<{ id: string; name: string }>(
    `SELECT id, name FROM branches WHERE business_id = $1 AND is_active = true ORDER BY name`,
    [businessId],
  );

  return NextResponse.json({ zones: result, branches: allBranches });
}

/**
 * PUT /api/settings/online-store/delivery
 * Upsert delivery zone for a branch.
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const {
    branch_id,
    location_lat,
    location_lng,
    location_address,
    delivery_mode,
    delivery_radius_km,
    serviceable_pincodes,
    allow_pickup,
    is_active,
    charges,
  } = body;

  if (!branch_id) {
    return NextResponse.json({ error: 'branch_id is required' }, { status: 400 });
  }

  const validModes = ['radius', 'pincode', 'all_india'];
  if (delivery_mode && !validModes.includes(delivery_mode)) {
    return NextResponse.json({ error: 'Invalid delivery_mode' }, { status: 400 });
  }

  // Upsert delivery zone
  const zone = await queryOne<{ id: string }>(
    `INSERT INTO store_branch_delivery
       (business_id, branch_id, location_lat, location_lng, location_address,
        delivery_mode, delivery_radius_km, serviceable_pincodes, allow_pickup, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (business_id, branch_id) DO UPDATE SET
       location_lat = EXCLUDED.location_lat,
       location_lng = EXCLUDED.location_lng,
       location_address = EXCLUDED.location_address,
       delivery_mode = EXCLUDED.delivery_mode,
       delivery_radius_km = EXCLUDED.delivery_radius_km,
       serviceable_pincodes = EXCLUDED.serviceable_pincodes,
       allow_pickup = EXCLUDED.allow_pickup,
       is_active = EXCLUDED.is_active,
       updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [
      businessId,
      branch_id,
      location_lat ?? null,
      location_lng ?? null,
      location_address ?? null,
      delivery_mode ?? 'radius',
      delivery_radius_km ?? 10,
      serviceable_pincodes ?? [],
      allow_pickup ?? true,
      is_active ?? true,
    ],
  );

  if (!zone) {
    return NextResponse.json({ error: 'Failed to save delivery zone' }, { status: 500 });
  }

  // Replace delivery charges
  if (Array.isArray(charges)) {
    await query('DELETE FROM store_delivery_charges WHERE branch_delivery_id = $1', [zone.id]);

    for (let i = 0; i < charges.length; i++) {
      const c = charges[i];
      await query(
        `INSERT INTO store_delivery_charges
           (branch_delivery_id, min_distance_km, max_distance_km, charge, free_above_amount, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          zone.id,
          c.min_distance_km ?? 0,
          c.max_distance_km ?? null,
          c.charge ?? 0,
          c.free_above_amount ?? null,
          i,
        ],
      );
    }
  }

  return NextResponse.json({ success: true, zone_id: zone.id });
}
