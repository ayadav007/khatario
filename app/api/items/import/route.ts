import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { seedOpeningStockLayers } from '@/lib/seed-opening-stock-layers';
import { Item } from '@/types/database';
import {
  getUserIdFromRequest,
  requireTenantBusinessId,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { checkLimit } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

interface ImportItem {
  name: string;
  code?: string;
  barcode?: string;
  unit?: string;
  item_type?: 'goods' | 'service';
  category_name?: string;
  selling_price?: number;
  purchase_price?: number;
  mrp?: number;
  tax_rate?: number;
  hsn_sac?: string;
  opening_stock?: number;
  min_stock?: number;
  description?: string;
  image_url?: string;
  is_active?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id: claimedBusinessId, items } = body as {
      business_id?: string;
      items?: ImportItem[];
    };

    const tenant = requireTenantBusinessId(request, claimedBusinessId);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const userId = getUserIdFromRequest(request, body);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No items to import' }, { status: 400 });
    }

    try {
      await authorize(userId, 'items', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId,
        limitType: 'items',
      });
    } catch (error) {
      const res = enforceAccessErrorResponse(error);
      if (res) return res;
      throw error;
    }

    const limitCheck = await checkLimit(business_id, 'items');
    if (
      !limitCheck.allowed ||
      (limitCheck.limit >= 0 && limitCheck.current + items.length > limitCheck.limit)
    ) {
      return NextResponse.json(
        {
          error: limitCheck.message || 'Item limit would be exceeded by this import',
          limit: limitCheck.limit,
          current: limitCheck.current,
          code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        },
        { status: 403 }
      );
    }

    let success = 0;
    let failed = 0;
    const errors: { row: number; reason: string }[] = [];

    for (let i = 0; i < items.length; i++) {
      const row = items[i];
      if (!row.name) {
        failed++;
        errors.push({ row: i + 1, reason: 'Missing name' });
        continue;
      }
      try {
        // Look up category by name if provided
        let categoryId = null;
        if (row.category_name) {
          const category = await queryOne(
            'SELECT id FROM categories WHERE business_id = $1 AND name = $2 LIMIT 1',
            [business_id, row.category_name.trim()]
          );
          categoryId = category?.id || null;
        }

        // Determine item_type (default to 'goods' if not specified)
        const itemType = row.item_type === 'service' ? 'service' : 'goods';
        
        // Set opening_stock to 0 for services
        const openingStock = itemType === 'service' ? 0 : (row.opening_stock ?? 0);

        const item = await queryOne<Item>(
          `INSERT INTO items (
            business_id, category_id, name, code, barcode, unit, item_type,
            selling_price, purchase_price, mrp, tax_rate, hsn_sac,
            opening_stock, current_stock, min_stock, description, image_url, is_active
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$14,$15,$16,$17)
          RETURNING id`,
          [
            business_id,
            categoryId,
            row.name,
            row.code || null,
            row.barcode || null,
            row.unit || 'PCS',
            itemType,
            row.selling_price ?? 0,
            row.purchase_price ?? 0,
            row.mrp || null,
            row.tax_rate ?? 18,
            row.hsn_sac || null,
            openingStock,
            row.min_stock ?? 0,
            row.description || null,
            row.image_url || null,
            row.is_active !== false, // default to true
          ]
        );

        // Record opening stock movement (only for goods)
        if (item && openingStock > 0) {
          await query(
            `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, notes)
             VALUES ($1, $2, 'in', $3, 'adjustment', 'Opening Stock (Import)')`,
            [business_id, item.id, openingStock]
          );
          await seedOpeningStockLayers(business_id, {
            itemId: item.id,
            quantity: openingStock,
          });
        }

        success++;
      } catch (err: any) {
        failed++;
        errors.push({ row: i + 1, reason: err.message || 'Insert failed' });
      }
    }

    return NextResponse.json({ success, failed, errors });
  } catch (error: any) {
    console.error('Import error', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
