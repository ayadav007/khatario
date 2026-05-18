import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

// Mapping of document types to prefixes and counter columns
const DOCUMENT_TYPE_CONFIG: Record<string, { prefix: string; counterColumn: string }> = {
  'tax_invoice': { prefix: 'INV', counterColumn: 'next_tax_invoice_number' },
  'regular': { prefix: 'INV', counterColumn: 'next_tax_invoice_number' },
  'proforma_invoice': { prefix: 'PI', counterColumn: 'next_proforma_invoice_number' },
  'bill_of_supply': { prefix: 'BOS', counterColumn: 'next_tax_invoice_number' }, // Use tax invoice counter for now
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const branchId = searchParams.get('branch_id'); // MANDATORY: Branch for invoice numbering
    const documentType = searchParams.get('document_type') || 'tax_invoice'; // Default to tax_invoice

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // PHASE 5: Require branch_id - do NOT fallback to default branch
    // Also reject 'ALL' as it's not a valid branch_id for document numbering
    if (!branchId || branchId === 'ALL') {
      return NextResponse.json(
        { error: 'branch_id is required to resolve document series. Incorrect prefix is a financial data corruption risk.' },
        { status: 400 }
      );
    }

    // Validate branch_id exists and belongs to business
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchId,
        businessId: businessId,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // Get configuration for this document type
    const config = DOCUMENT_TYPE_CONFIG[documentType] || DOCUMENT_TYPE_CONFIG['tax_invoice'];
    
    // Only READ the current counter value from branch (don't increment yet)
    // Increment will happen only when invoice is actually saved
    const result = await queryOne<{ next_invoice_number: number }>(`
      SELECT next_invoice_number
      FROM branches 
      WHERE id = $1 AND business_id = $2
    `, [finalBranchId, businessId]);

    if (!result) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 });
    }
    
    // Check for branch-specific prefix for this document type
    let invoicePrefix = config.prefix;
    try {
      const { queryRows } = await import('@/lib/db');
      const branchPrefixRows = await queryRows<{ prefix: string }>(`
        SELECT prefix FROM branch_document_prefixes 
        WHERE branch_id = $1 AND document_type = $2
      `, [finalBranchId, documentType]);
      
      // Use branch-specific prefix if available, otherwise use document type default
      if (branchPrefixRows[0]?.prefix) {
        invoicePrefix = branchPrefixRows[0].prefix;
      }
    } catch (error: any) {
      // If table doesn't exist yet (migration not run), use document type default
      if (error.code !== '42P01') { // Only ignore "table does not exist" error
        throw error;
      }
      // Otherwise, continue with document type default prefix
    }
    
    // Return the current next number (without incrementing)
    const nextNumber = result.next_invoice_number || 1;
    // Use minimum 3 digits padding, but allow growth beyond 999
    const formattedNumber = String(nextNumber).padStart(3, '0');
    
    return NextResponse.json({ 
      invoice_number: formattedNumber,
      invoice_prefix: invoicePrefix,
      prefix: invoicePrefix,
      full_number: `${invoicePrefix}-${formattedNumber}`,
      next_number: nextNumber // Return raw number for API use
    });

  } catch (error: any) {
    console.error('Error fetching next invoice number:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
