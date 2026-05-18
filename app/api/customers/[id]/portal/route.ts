import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { queryOne } from '@/lib/db';
import {
  customerPortalUrl,
  ensureBusinessPortalSlug,
} from '@/lib/customer-surface';
import { sendBusinessEmail } from '@/lib/business-email';

/**
 * PATCH /api/customers/[id]/portal
 * Enable/disable customer portal + optional invite email.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const businessScope = getBusinessIdFromRequest(request);
    if (!businessScope) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const customer = await queryOne<{
      id: string;
      business_id: string;
      name: string;
      email: string | null;
      portal_enabled: boolean;
    }>(
      `SELECT id, business_id, name, email, portal_enabled
       FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [params.id, businessScope]
    );

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'customers', 'update', {
        businessId: customer.business_id,
        resourceId: params.id,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json();
    const portalEnabled = Boolean(body.portal_enabled);
    const sendInvite = Boolean(body.send_invite);

    if (portalEnabled && !customer.email?.trim()) {
      return NextResponse.json(
        { error: 'Customer must have an email address to enable the portal.' },
        { status: 400 }
      );
    }

    const business = await queryOne<{ name: string }>(
      `SELECT name FROM businesses WHERE id = $1`,
      [businessScope]
    );
    const businessName = business?.name ?? 'Your supplier';
    const portalSlug = await ensureBusinessPortalSlug(businessScope, businessName);
    const portalUrl = customerPortalUrl(portalSlug);

    await queryOne(
      `UPDATE customers
       SET portal_enabled = $2,
           portal_invited_at = CASE
             WHEN $2 AND portal_invited_at IS NULL THEN CURRENT_TIMESTAMP
             ELSE portal_invited_at
           END
       WHERE id = $1`,
      [params.id, portalEnabled]
    );

    if (portalEnabled && sendInvite && customer.email) {
      const html = [
        '<div style="font-family: Arial, sans-serif; font-size: 16px; color: #222;">',
        `<p>Hello ${customer.name},</p>`,
        `<p><strong>${businessName}</strong> has enabled your customer portal. You can view all your bills in one place.</p>`,
        `<p><a href="${portalUrl}">Open your portal</a></p>`,
        '<p style="color:#555;">Sign in with this email address to access your invoices.</p>',
        '</div>',
      ].join('');

      await sendBusinessEmail(businessScope, {
        to: customer.email.trim(),
        subject: `${businessName} — your customer portal`,
        html,
        text: `Open your portal: ${portalUrl}\nSign in with ${customer.email}.`,
      });
    }

    return NextResponse.json({
      ok: true,
      portal_enabled: portalEnabled,
      portal_url: portalUrl,
      portal_slug: portalSlug,
    });
  } catch (error: unknown) {
    console.error('[customers/portal]', error);
    return NextResponse.json({ error: 'Failed to update portal access' }, { status: 500 });
  }
}
