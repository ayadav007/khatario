import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';

/**
 * Get supplier relationship requests
 * GET /api/suppliers/requests?business_id=xxx&type=received|sent
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const type = searchParams.get('type') || 'all'; // 'received', 'sent', or 'all'

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let requests: any = {
      received: [],
      sent: []
    };

    // Received requests (where this business is the linked_business_id)
    if (type === 'received' || type === 'all') {
      const receivedQuery = `
        SELECT 
          s.id,
          s.name,
          s.phone,
          s.email,
          s.address,
          s.city,
          s.state,
          s.pincode,
          s.gstin,
          s.approval_status,
          s.created_at,
          s.approved_at,
          s.rejected_at,
          s.rejection_reason,
          rb.id as requester_id,
          rb.name as requester_name,
          rb.phone as requester_phone,
          rb.email as requester_email
        FROM suppliers s
        LEFT JOIN businesses rb ON s.requested_by_business_id = rb.id
        WHERE s.linked_business_id = $1
        AND s.deleted_at IS NULL
        AND s.approval_status IN ('pending', 'approved', 'rejected')
        ORDER BY 
          CASE s.approval_status
            WHEN 'pending' THEN 1
            WHEN 'approved' THEN 2
            WHEN 'rejected' THEN 3
          END,
          s.created_at DESC
      `;
      requests.received = await queryRows(receivedQuery, [businessId]);
    }

    // Sent requests (where this business is the requested_by_business_id)
    if (type === 'sent' || type === 'all') {
      const sentQuery = `
        SELECT 
          s.id,
          s.name,
          s.phone,
          s.email,
          s.address,
          s.city,
          s.state,
          s.pincode,
          s.gstin,
          s.approval_status,
          s.created_at,
          s.approved_at,
          s.rejected_at,
          s.rejection_reason,
          lb.id as linked_business_id,
          lb.name as linked_business_name,
          lb.phone as linked_business_phone,
          lb.email as linked_business_email
        FROM suppliers s
        LEFT JOIN businesses lb ON s.linked_business_id = lb.id
        WHERE s.requested_by_business_id = $1
        AND s.deleted_at IS NULL
        AND s.linked_business_id IS NOT NULL
        AND s.approval_status IN ('pending', 'approved', 'rejected')
        ORDER BY 
          CASE s.approval_status
            WHEN 'pending' THEN 1
            WHEN 'approved' THEN 2
            WHEN 'rejected' THEN 3
          END,
          s.created_at DESC
      `;
      requests.sent = await queryRows(sentQuery, [businessId]);
    }

    // Count stats
    const stats = {
      received_pending: requests.received.filter((r: any) => r.approval_status === 'pending').length,
      received_approved: requests.received.filter((r: any) => r.approval_status === 'approved').length,
      received_rejected: requests.received.filter((r: any) => r.approval_status === 'rejected').length,
      sent_pending: requests.sent.filter((r: any) => r.approval_status === 'pending').length,
      sent_approved: requests.sent.filter((r: any) => r.approval_status === 'approved').length,
      sent_rejected: requests.sent.filter((r: any) => r.approval_status === 'rejected').length,
    };

    return NextResponse.json({
      success: true,
      requests,
      stats
    });

  } catch (error: any) {
    console.error('Error fetching supplier requests:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch supplier requests' },
      { status: 500 }
    );
  }
}

