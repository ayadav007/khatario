import { NextRequest, NextResponse } from 'next/server';
import { recordTaxPayment, getTaxPayments } from '@/lib/services/tax-provision-calculator';

/**
 * GET /api/tax-provisions/[id]/payments
 * Get tax payments for a provision
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const payments = await getTaxPayments(params.id);
    return NextResponse.json({ payments });
  } catch (error: any) {
    console.error('Error fetching tax payments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch tax payments', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tax-provisions/[id]/payments
 * Record tax payment
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const {
      business_id,
      payment_date,
      payment_amount,
      payment_mode,
      challan_number,
      bank_name,
      reference_number,
      notes,
      user_id,
    } = body;

    if (!business_id || !payment_date || !payment_amount) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const paymentId = await recordTaxPayment(
      business_id,
      params.id,
      payment_date,
      payment_amount,
      payment_mode,
      challan_number,
      bank_name,
      reference_number,
      notes,
      user_id
    );

    return NextResponse.json({ id: paymentId }, { status: 201 });
  } catch (error: any) {
    console.error('Error recording tax payment:', error);
    return NextResponse.json(
      { error: 'Failed to record tax payment', details: error.message },
      { status: 500 }
    );
  }
}

