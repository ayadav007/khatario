/**
 * GSTR-2B Reconciliation Decision API
 * 
 * Record user decisions for reconciliation mismatches
 */

import { NextRequest, NextResponse } from 'next/server';
import { GSTR2BReconciliationEngine, UserDecision } from '@/lib/gst/gstr2b-reconciliation';

const reconciliationEngine = new GSTR2BReconciliationEngine();

/**
 * POST /api/gst/gstr2b/decision
 * Record a user decision for a reconciliation record
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      reconciliation_id,
      decision,
      remarks,
      eligible_itc_amount,
      deferred_to_period,
      decided_by_user_id
    } = body;
    
    if (!business_id || !reconciliation_id || !decision || !decided_by_user_id) {
      return NextResponse.json(
        { error: 'business_id, reconciliation_id, decision, and decided_by_user_id are required' },
        { status: 400 }
      );
    }
    
    // Validate decision value
    const validDecisions = [
      'PENDING_SUPPLIER_CORRECTION',
      'ITC_ELIGIBLE_THIS_PERIOD',
      'ITC_DEFERRED_TO_FUTURE',
      'ITC_NOT_ELIGIBLE',
      'IGNORE'
    ];
    
    if (!validDecisions.includes(decision)) {
      return NextResponse.json(
        { error: `Invalid decision. Must be one of: ${validDecisions.join(', ')}` },
        { status: 400 }
      );
    }
    
    // If deferred, validate deferred_to_period format
    if (decision === 'ITC_DEFERRED_TO_FUTURE' && deferred_to_period) {
      if (!/^\d{4}-\d{2}$/.test(deferred_to_period)) {
        return NextResponse.json(
          { error: 'deferred_to_period must be in YYYY-MM format' },
          { status: 400 }
        );
      }
    }
    
    const userDecision: UserDecision = {
      reconciliation_id,
      decision,
      remarks: remarks || undefined,
      eligible_itc_amount: eligible_itc_amount ? parseFloat(eligible_itc_amount) : undefined,
      deferred_to_period: deferred_to_period || undefined,
      decided_by_user_id
    };
    
    await reconciliationEngine.recordDecision(business_id, userDecision);
    
    return NextResponse.json({
      success: true,
      message: 'Decision recorded successfully'
    });
    
  } catch (error: any) {
    console.error('Error recording decision:', error);
    return NextResponse.json(
      { error: 'Failed to record decision', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gst/gstr2b/decision/eligible-itc
 * Get total eligible ITC for a filing period (only ITC_ELIGIBLE_THIS_PERIOD)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const business_id = searchParams.get('business_id');
    const filing_period = searchParams.get('filing_period');
    
    if (!business_id || !filing_period) {
      return NextResponse.json(
        { error: 'business_id and filing_period are required' },
        { status: 400 }
      );
    }
    
    const eligibleITC = await reconciliationEngine.getEligibleITC(business_id, filing_period);
    
    return NextResponse.json({
      filing_period,
      eligible_itc: eligibleITC
    });
    
  } catch (error: any) {
    console.error('Error fetching eligible ITC:', error);
    return NextResponse.json(
      { error: 'Failed to fetch eligible ITC', details: error.message },
      { status: 500 }
    );
  }
}

