import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { getPool } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { isInterBranchTransfer, createInterBranchInvoice, isEwayBillRequired } from '@/lib/inter-branch-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/stock-transfers
 * Fetch all stock transfers for a business
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(businessId, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission (PBAC will check source/destination warehouse access, business ownership)
    try {
      await authorize(userId, 'warehouse_transfer', 'read', {
        businessId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs for filtering
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // Continue without branch filtering if error
    }

    // Filter transfers by warehouse's branch_id if user has branch access
    let branchFilter = '';
    const params: any[] = [businessId];
    let paramIndex = 2;
    
    if (accessibleBranchIds.length > 0) {
      // Show transfers where either from or to warehouse is linked to user's accessible branches
      branchFilter = ` AND (
        EXISTS (
          SELECT 1 FROM warehouses fw 
          WHERE fw.id = st.from_location_id 
          AND (fw.branch_id = ANY($${paramIndex}::uuid[]) OR fw.branch_id IS NULL)
        )
        OR EXISTS (
          SELECT 1 FROM warehouses tw 
          WHERE tw.id = st.to_location_id 
          AND (tw.branch_id = ANY($${paramIndex}::uuid[]) OR tw.branch_id IS NULL)
        )
        OR EXISTS (
          SELECT 1 FROM branch_warehouses bw
          WHERE bw.warehouse_id = st.from_location_id
          AND bw.branch_id = ANY($${paramIndex}::uuid[])
        )
        OR EXISTS (
          SELECT 1 FROM branch_warehouses bw
          WHERE bw.warehouse_id = st.to_location_id
          AND bw.branch_id = ANY($${paramIndex}::uuid[])
        )
      )`;
      params.push(accessibleBranchIds);
    }

    const transfers = await db.queryRows(`
      SELECT 
        st.*,
        fw.name as from_warehouse_name,
        tw.name as to_warehouse_name,
        u.name as approved_by_name,
        creator.name as created_by_name
      FROM stock_transfers st
      LEFT JOIN warehouses fw ON st.from_location_id = fw.id
      LEFT JOIN warehouses tw ON st.to_location_id = tw.id
      LEFT JOIN users u ON st.approved_by = u.id
      LEFT JOIN users creator ON st.created_by = creator.id
      WHERE st.business_id = $1
      ${branchFilter}
      ORDER BY st.created_at DESC
    `, params);

    return NextResponse.json({ transfers });
  } catch (error: any) {
    console.error('Error fetching stock transfers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock transfers', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stock-transfers
 * Create a new stock transfer
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      transfer_number,
      transfer_date,
      from_location_id,
      to_location_id,
      items,
      notes,
    } = body;

    const created_by = body.created_by || getUserIdFromRequest(request, body);

    if (!business_id || !transfer_number || !from_location_id || !to_location_id || !items) {
      return NextResponse.json(
        { error: 'business_id, transfer_number, from_location_id, to_location_id, and items are required' },
        { status: 400 }
      );
    }

    if (from_location_id === to_location_id) {
      return NextResponse.json(
        { error: 'Source and destination locations cannot be the same' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check create permission (PBAC will check source/destination warehouse access, different warehouses, period lock, stock freeze)
    try {
      await authorize(created_by, 'warehouse_transfer', 'create', {
        businessId: business_id,
        sourceWarehouseId: from_location_id,
        destinationWarehouseId: to_location_id,
        transfer_date: transfer_date,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check if this is an inter-branch transfer
      const transferInfo = await isInterBranchTransfer(from_location_id, to_location_id);
      const isInterBranch = transferInfo.isInterBranch && transferInfo.hasDifferentGstin;

      // Validate e-way bill requirement for inter-state transfers
      if (isInterBranch && transferInfo.isInterState) {
        const transferValue = items.reduce((sum: number, item: any) => sum + (item.unit_price || 0) * (item.qty || 0), 0);
        const ewayRequired = isEwayBillRequired(transferValue, transferInfo.isInterState);
        
        // Note: E-way bill validation should be done in frontend or via separate API
        // For now, we'll just log a warning if e-way bill is required but not provided
        if (ewayRequired && !body.eway_bill_number) {
          console.warn(`E-way bill required for inter-state transfer > ₹50,000. Transfer value: ₹${transferValue}`);
        }
      }

      // Determine initial status based on user's approval permission
      // If user has approve permission, create as 'pending' (auto-approved)
      // Otherwise, create as 'draft' (needs approval)
      let initialStatus = 'draft';
      try {
        // Check if user has approve permission
        await authorize(created_by, 'warehouse_transfer', 'approve', {
          businessId: business_id,
          sourceWarehouseId: from_location_id,
          destinationWarehouseId: to_location_id,
        });
        // If no error, user has approve permission - auto-approve
        initialStatus = 'pending';
      } catch (error) {
        // User doesn't have approve permission - create as draft
        initialStatus = 'draft';
      }

      // Create transfer with status 'draft' or 'pending' (NO stock movement yet)
      const transferResult = await client.query(`
        INSERT INTO stock_transfers (
          business_id, transfer_number, transfer_date, from_location_id, to_location_id, 
          status, notes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `, [business_id, transfer_number, transfer_date, from_location_id, to_location_id, initialStatus, notes, created_by]);

      const transfer = transferResult.rows[0];

      // If inter-branch transfer, create invoice (only for approved transfers)
      let interBranchInvoiceId: string | undefined;
      if (isInterBranch && transferInfo.fromWarehouse.branch && transferInfo.toWarehouse.branch && initialStatus === 'pending') {
        try {
          // Get item details for invoice
          const invoiceItems = await Promise.all(items.map(async (item: any) => {
            const itemData = await client.query(`
              SELECT name, hsn_sac, tax_rate, purchase_price
              FROM items
              WHERE id = $1
            `, [item.item_id]);
            
            return {
              item_id: item.item_id,
              description: item.description || itemData.rows[0]?.name || 'Item',
              qty: item.qty,
              unit: item.unit || 'PCS',
              unit_price: item.unit_price || 0,
              tax_rate: item.tax_rate || itemData.rows[0]?.tax_rate || 0,
              discount: item.discount || 0,
              hsn_sac: item.hsn_sac || itemData.rows[0]?.hsn_sac || null,
            };
          }));

          const invoice = await createInterBranchInvoice({
            businessId: business_id,
            fromBranchId: transferInfo.fromWarehouse.branch.id,
            toBranchId: transferInfo.toWarehouse.branch.id,
            transferId: transfer.id,
            transferNumber: transfer_number,
            transferDate: transfer_date,
            items: invoiceItems,
            notes: notes,
            ewayBillNumber: body.eway_bill_number,
            ewayBillDate: body.eway_bill_date,
          });

          interBranchInvoiceId = invoice.invoiceId;

          // Update transfer with invoice ID
          await client.query(`
            UPDATE stock_transfers
            SET inter_branch_invoice_id = $1
            WHERE id = $2
          `, [invoice.invoiceId, transfer.id]);
        } catch (invoiceError: any) {
          console.error('Error creating inter-branch invoice:', invoiceError);
          // Don't fail transfer if invoice creation fails, but log it
        }
      }

      // Create transfer items (NO stock movement - stock will be deducted on DISPATCH)
      for (const item of items) {
        const requestedQty = parseFloat(item.qty || '0');
        
        // Get item cost for snapshot
        const itemData = await client.query(`
          SELECT purchase_price FROM items WHERE id = $1
        `, [item.item_id]);
        const costSnapshot = parseFloat(itemData.rows[0]?.purchase_price || '0');

        await client.query(`
          INSERT INTO stock_transfer_items (
            transfer_id, item_id, qty, unit, notes, 
            quantity_requested, quantity_dispatched, cost_snapshot
          )
          VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
        `, [
          transfer.id, 
          item.item_id, 
          item.qty, 
          item.unit, 
          item.notes || null,
          requestedQty,
          costSnapshot
        ]);
      }

      await client.query('COMMIT');
      return NextResponse.json({ transfer }, { status: 201 });
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('Error creating stock transfer:', error);
      return NextResponse.json(
        { error: 'Failed to create stock transfer', details: error.message },
        { status: 500 }
      );
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error creating stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to create stock transfer', details: error.message },
      { status: 500 }
    );
  }
}

