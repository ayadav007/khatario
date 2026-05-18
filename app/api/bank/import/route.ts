import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne } from '@/lib/db';
import { extractBankRowsFromCsv } from '@/lib/bank/csv-extract';
import { extractBankRowsFromPdf } from '@/lib/bank/pdf-extract';
import type { BankImportPreview } from '@/lib/bank/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function detectKind(fileName: string, buffer: Buffer): 'csv' | 'pdf' {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.pdf')) return 'pdf';
  const head = buffer.subarray(0, 5).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  return 'csv';
}

/**
 * POST /api/bank/import
 * multipart/form-data: file, bank_account_id, business_id (optional if header)
 * Returns preview only — does not persist.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const form = await request.formData();
    const file = form.get('file');
    const bankAccountId = String(form.get('bank_account_id') || '').trim();
    const businessId =
      String(form.get('business_id') || '').trim() || getBusinessIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!bankAccountId) {
      return NextResponse.json({ error: 'bank_account_id is required' }, { status: 400 });
    }
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId });
    } catch (e) {
      if (e instanceof AuthorizationError) return e.toNextResponse();
      throw e;
    }

    const ba = await queryOne<{ id: string }>(
      'SELECT id FROM bank_accounts WHERE id = $1 AND business_id = $2',
      [bankAccountId, businessId]
    );
    if (!ba) {
      return NextResponse.json({ error: 'Bank account not found' }, { status: 404 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const fileName = (file as File).name || 'statement';
    const kind = detectKind(fileName, buf);

    let preview: BankImportPreview;
    if (kind === 'pdf') {
      preview = await extractBankRowsFromPdf(buf, fileName);
    } else {
      preview = extractBankRowsFromCsv(buf, fileName);
    }

    return NextResponse.json({
      preview,
      bank_account_id: bankAccountId,
      business_id: businessId,
    });
  } catch (error: any) {
    console.error('bank import preview error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to process upload' },
      { status: 500 }
    );
  }
}
