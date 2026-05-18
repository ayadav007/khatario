/**
 * NOTE:
 * This module is intentionally isolated.
 * Do NOT import CRM, WhatsApp, or campaign logic here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { NormalizedLead } from '@/lib/google-leads/normalizer';

/**
 * Convert leads to CSV format
 */
function generateCSV(leads: NormalizedLead[]): string {
  const headers = [
    'Business Name',
    'Phone',
    'Website',
    'Address',
    'Rating',
    'Total Reviews',
    'Google Maps Link',
  ];

  const rows = leads.map(lead => [
    escapeCSVField(lead.business_name),
    escapeCSVField(lead.phone || ''),
    escapeCSVField(lead.website || ''),
    escapeCSVField(lead.address),
    escapeCSVField(lead.rating?.toString() || ''),
    escapeCSVField(lead.reviews?.toString() || ''),
    escapeCSVField(lead.maps_url),
  ]);

  return [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ].join('\n');
}

/**
 * Escape CSV field (handle commas, quotes, newlines)
 */
function escapeCSVField(field: string): string {
  if (!field) return '';
  
  // If field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  
  return field;
}

/**
 * Generate Excel file (simple CSV with .xlsx extension, or use a library)
 * For now, we'll use CSV format but with proper Excel-compatible headers
 */
function generateExcel(leads: NormalizedLead[]): Buffer {
  // Simple implementation: generate CSV (Excel can open CSV)
  // For true Excel format, you'd need a library like exceljs, but to avoid dependencies,
  // we'll use CSV which Excel can open
  const csv = generateCSV(leads);
  return Buffer.from(csv, 'utf-8');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { leads, format = 'csv' } = body;

    // Validate input
    if (!leads || !Array.isArray(leads)) {
      return NextResponse.json(
        { error: 'Leads array is required' },
        { status: 400 }
      );
    }

    if (leads.length === 0) {
      return NextResponse.json(
        { error: 'No leads to export' },
        { status: 400 }
      );
    }

    if (format !== 'csv' && format !== 'excel') {
      return NextResponse.json(
        { error: 'Format must be "csv" or "excel"' },
        { status: 400 }
      );
    }

    // Generate file
    let fileContent: Buffer;
    let contentType: string;
    let fileExtension: string;

    if (format === 'csv') {
      const csv = generateCSV(leads);
      fileContent = Buffer.from(csv, 'utf-8');
      contentType = 'text/csv; charset=utf-8';
      fileExtension = 'csv';
    } else {
      // Excel format (CSV for now)
      fileContent = generateExcel(leads);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      fileExtension = 'xlsx';
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `google-leads-${timestamp}.${fileExtension}`;

    // Return file download
    return new NextResponse(fileContent as any, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': fileContent.length.toString(),
      },
    });

  } catch (error: any) {
    console.error('[Google Leads Export] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to export leads' },
      { status: 500 }
    );
  }
}

