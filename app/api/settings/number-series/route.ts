import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { query, queryOne, queryRows } from '@/lib/db';
import { authorize } from '@/lib/authorization';
import { AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {
      return NextResponse.json(
        { error: 'business_id and user_id are required' },
        { status: 400 }
      );
    }

    // Authorization check
    try {
      await authorize(userId, 'settings', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch business numbering configuration
    const business = await queryOne<{
      next_tax_invoice_number: number;
      next_proforma_invoice_number: number;
      next_retail_invoice_number: number;
      next_export_invoice_number: number;
    }>(
      `SELECT 
        next_tax_invoice_number,
        next_proforma_invoice_number,
        next_retail_invoice_number,
        next_export_invoice_number
      FROM businesses 
      WHERE id = $1`,
      [businessId]
    );

    // Fetch branches with their numbering config
    const branches = await queryRows<{
      id: string;
      name: string;
      invoice_prefix: string | null;
      next_invoice_number: number;
      is_default: boolean;
    }>(
      `SELECT id, name, invoice_prefix, next_invoice_number, is_default
      FROM branches
      WHERE business_id = $1 AND is_active = true
      ORDER BY is_default DESC, name ASC`,
      [businessId]
    );

    // Fetch branch-specific document prefixes (if branches exist and table exists)
    let branchPrefixMap: Record<string, Record<string, string>> = {};
    if (branches.length > 0) {
      try {
        const branchIds = branches.map(b => b.id);
        const branchPrefixes = await queryRows<{
          branch_id: string;
          document_type: string;
          prefix: string;
        }>(
          `SELECT branch_id, document_type, prefix
          FROM branch_document_prefixes
          WHERE branch_id = ANY($1::uuid[])`,
          [branchIds]
        );

        // Organize prefixes by branch and document type
        branchPrefixes.forEach(bp => {
          if (!branchPrefixMap[bp.branch_id]) {
            branchPrefixMap[bp.branch_id] = {};
          }
          branchPrefixMap[bp.branch_id][bp.document_type] = bp.prefix;
        });
      } catch (error: any) {
        // If table doesn't exist yet (migration not run), just use empty map
        // This allows the page to load even if migration hasn't been run
        console.warn('branch_document_prefixes table not found, using empty prefix map:', error.message);
        branchPrefixMap = {};
      }
    }

    // Get current max numbers from actual invoices for each document type (business-wide)
    const invoiceStats = await queryRows<{
      document_type: string;
      max_number: number;
    }>(
      `SELECT 
        COALESCE(document_type, 'tax_invoice') as document_type,
        MAX(CAST(SUBSTRING(invoice_number FROM '(\d+)$') AS INTEGER)) as max_number
      FROM invoices
      WHERE business_id = $1
      GROUP BY document_type`,
      [businessId]
    );

    const statsMap: Record<string, number> = {};
    invoiceStats.forEach(stat => {
      statsMap[stat.document_type || 'tax_invoice'] = stat.max_number || 0;
    });

    // Get branch-specific stats for invoices
    const branchStats: Record<string, Record<string, number>> = {};
    for (const branch of branches) {
      const branchInvoiceStats = await queryRows<{
        document_type: string;
        max_number: number;
      }>(
        `SELECT 
          COALESCE(document_type, 'tax_invoice') as document_type,
          MAX(CAST(SUBSTRING(invoice_number FROM '(\d+)$') AS INTEGER)) as max_number
        FROM invoices
        WHERE business_id = $1 AND branch_id = $2
        GROUP BY document_type`,
        [businessId, branch.id]
      );

      branchStats[branch.id] = {};
      branchInvoiceStats.forEach(stat => {
        branchStats[branch.id][stat.document_type || 'tax_invoice'] = stat.max_number || 0;
      });
    }

    // Get stats from other document tables
    try {
      // Sales Orders
      const salesOrderStats = await queryRows<{ max_number: number }>(
        `SELECT MAX(CAST(SUBSTRING(order_number FROM '(\d+)$') AS INTEGER)) as max_number
        FROM sales_orders WHERE business_id = $1`,
        [businessId]
      );
      if (salesOrderStats[0]?.max_number) {
        statsMap['sales_order'] = salesOrderStats[0].max_number;
      }

      // Delivery Challans
      const deliveryChallanStats = await queryRows<{ max_number: number }>(
        `SELECT MAX(CAST(SUBSTRING(challan_number FROM '(\d+)$') AS INTEGER)) as max_number
        FROM delivery_challans WHERE business_id = $1`,
        [businessId]
      );
      if (deliveryChallanStats[0]?.max_number) {
        statsMap['delivery_challan'] = deliveryChallanStats[0].max_number;
      }

      // Credit Notes
      const creditNoteStats = await queryRows<{ max_number: number }>(
        `SELECT MAX(CAST(SUBSTRING(credit_note_number FROM '(\d+)$') AS INTEGER)) as max_number
        FROM credit_notes WHERE business_id = $1`,
        [businessId]
      );
      if (creditNoteStats[0]?.max_number) {
        statsMap['credit_note'] = creditNoteStats[0].max_number;
      }

      // Debit Notes
      const debitNoteStats = await queryRows<{ max_number: number }>(
        `SELECT MAX(CAST(SUBSTRING(debit_note_number FROM '(\d+)$') AS INTEGER)) as max_number
        FROM debit_notes WHERE business_id = $1`,
        [businessId]
      );
      if (debitNoteStats[0]?.max_number) {
        statsMap['debit_note'] = debitNoteStats[0].max_number;
      }

      // Purchase Orders
      const purchaseOrderStats = await queryRows<{ max_number: number }>(
        `SELECT MAX(CAST(SUBSTRING(order_number FROM '(\d+)$') AS INTEGER)) as max_number
        FROM purchase_orders WHERE business_id = $1`,
        [businessId]
      );
      if (purchaseOrderStats[0]?.max_number) {
        statsMap['purchase_order'] = purchaseOrderStats[0].max_number;
      }

      // Work Orders
      const workOrderStats = await queryRows<{ max_number: number }>(
        `SELECT MAX(CAST(SUBSTRING(work_order_number FROM '(\d+)$') AS INTEGER)) as max_number
        FROM work_orders WHERE business_id = $1`,
        [businessId]
      );
      if (workOrderStats[0]?.max_number) {
        statsMap['work_order'] = workOrderStats[0].max_number;
      }
    } catch (error) {
      // Some tables might not exist yet, ignore errors
      console.warn('Error fetching stats from other document tables:', error);
    }

    return NextResponse.json({
      business: {
        next_tax_invoice_number: business?.next_tax_invoice_number || 1,
        next_proforma_invoice_number: business?.next_proforma_invoice_number || 1,
        next_retail_invoice_number: business?.next_retail_invoice_number || 1,
        next_export_invoice_number: business?.next_export_invoice_number || 1,
      },
      branches: branches || [],
      currentStats: statsMap,
      branchStats: branchStats, // Branch-specific current numbers
      branchPrefixes: branchPrefixMap, // Branch-specific prefixes per document type
    });
  } catch (error: any) {
    console.error('Error fetching number series config:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch number series configuration' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      document_type,
      prefix,
      starting_number,
      branch_ids, // Array of branch IDs to apply settings to
    } = body;
    const user_id = getUserIdFromRequest(request, body);

    if (!business_id || !user_id || !document_type) {
      return NextResponse.json(
        { error: 'business_id, user_id, and document_type are required' },
        { status: 400 }
      );
    }

    // Authorization check
    try {
      await authorize(user_id, 'settings', 'update');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Map document types to counter columns
    // Note: Some document types (sales_order, delivery_challan, etc.) may not have separate counters yet
    // They might use a generic counter or be handled differently
    const counterColumnMap: Record<string, string> = {
      'tax_invoice': 'next_tax_invoice_number',
      'regular': 'next_tax_invoice_number',
      'proforma_invoice': 'next_proforma_invoice_number',
      'retail_invoice': 'next_retail_invoice_number',
      'export_invoice': 'next_export_invoice_number',
      'bill_of_supply': 'next_tax_invoice_number',
      // These document types may not have dedicated counters yet
      'sales_order': 'next_tax_invoice_number', // Placeholder - may need separate column
      'delivery_challan': 'next_tax_invoice_number',
      'credit_note': 'next_tax_invoice_number',
      'debit_note': 'next_tax_invoice_number',
      'purchase_order': 'next_tax_invoice_number',
      'work_order': 'next_tax_invoice_number',
    };

    const counterColumn = counterColumnMap[document_type];
    if (!counterColumn) {
      return NextResponse.json(
        { error: `Invalid document_type: ${document_type}` },
        { status: 400 }
      );
    }

    // Update branch-specific settings if branch_ids are provided
    if (branch_ids && Array.isArray(branch_ids) && branch_ids.length > 0) {
      // Update starting number for selected branches (for invoice types that use branch counters)
      if (starting_number !== undefined && ['tax_invoice', 'regular', 'proforma_invoice', 'bill_of_supply'].includes(document_type)) {
        const startingNum = Math.max(1, parseInt(starting_number));
        for (const branchId of branch_ids) {
          await query(
            `UPDATE branches 
            SET next_invoice_number = $1
            WHERE id = $2 AND business_id = $3`,
            [startingNum, branchId, business_id]
          );
        }
      }

      // Update branch document-specific prefix if prefix is provided
      if (prefix) {
        try {
          for (const branchId of branch_ids) {
            // Use UPSERT to insert or update the prefix for this document type and branch
            await query(
              `INSERT INTO branch_document_prefixes (branch_id, document_type, prefix, updated_at)
               VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
               ON CONFLICT (branch_id, document_type)
               DO UPDATE SET prefix = $3, updated_at = CURRENT_TIMESTAMP`,
              [branchId, document_type, prefix]
            );
          }
        } catch (error: any) {
          // If table doesn't exist, return helpful error message
          if (error.code === '42P01') { // Table does not exist
            return NextResponse.json(
              { error: 'branch_document_prefixes table not found. Please run migration 141_branch_document_prefixes.sql' },
              { status: 500 }
            );
          }
          throw error;
        }
      }
    } else {
      // Only update business-level counter if NO branch_ids are provided (single branch or business-wide default)
      // This ensures branch-specific updates don't affect business-level counters
      if (starting_number !== undefined && ['tax_invoice', 'regular', 'proforma_invoice', 'retail_invoice', 'export_invoice', 'bill_of_supply'].includes(document_type)) {
        await query(
          `UPDATE businesses 
          SET ${counterColumn} = $1
          WHERE id = $2`,
          [Math.max(1, parseInt(starting_number)), business_id]
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Number series configuration updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating number series config:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update number series configuration' },
      { status: 500 }
    );
  }
}
