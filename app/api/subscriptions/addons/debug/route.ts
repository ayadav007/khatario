import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { hasWhatsAppBotAddon, getBusinessAddons } from '@/lib/subscription';

/**
 * GET /api/subscriptions/addons/debug
 * Debug endpoint to check addon status
 */
export async function GET(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const searchParams = request.nextUrl.searchParams;
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    // Check if table exists
    const tableExists = await db.queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'whatsapp_addons'
      ) as exists
    `);

    // Get all addons for this business (including inactive)
    const allAddons = await db.queryRows(`
      SELECT * FROM whatsapp_addons
      WHERE business_id = $1
      ORDER BY created_at DESC
    `, [businessId]).catch(() => []);

    // Get active addons using the function
    const activeAddons = await getBusinessAddons(businessId).catch(() => []);

    // Check using the hasWhatsAppBotAddon function
    const hasBotAddon = await hasWhatsAppBotAddon(businessId).catch(() => false);

    return NextResponse.json({
      debug: {
        table_exists: tableExists?.exists || false,
        business_id: businessId,
        all_addons_in_db: allAddons,
        active_addons: activeAddons || [],
        has_whatsapp_bot_addon: hasBotAddon,
        addon_check_details: {
          whatsapp_bot_count: allAddons.filter((a: any) => a.addon_type === 'whatsapp_bot' && a.status === 'active').length,
          whatsapp_send_message_count: allAddons.filter((a: any) => a.addon_type === 'whatsapp_send_message' && a.status === 'active').length,
        },
        current_date_check: {
          current_date: new Date().toISOString().split('T')[0],
          date_validation: allAddons.map((a: any) => {
            // Handle date strings - extract just the date part if it's a timestamp
            const startDateStr = a.start_date instanceof Date 
              ? a.start_date.toISOString().split('T')[0]
              : (typeof a.start_date === 'string' ? a.start_date.split('T')[0] : a.start_date);
            const endDateStr = a.end_date instanceof Date
              ? a.end_date.toISOString().split('T')[0]
              : (typeof a.end_date === 'string' ? a.end_date.split('T')[0] : a.end_date);
            const today = new Date().toISOString().split('T')[0];
            
            const isStarted = !startDateStr || startDateStr <= today;
            const isNotExpired = !endDateStr || endDateStr >= today;
            const shouldBeActive = a.status === 'active' && isStarted && isNotExpired;
            
            return {
              addon_type: a.addon_type,
              start_date: startDateStr,
              end_date: endDateStr,
              status: a.status,
              is_started: isStarted,
              is_not_expired: isNotExpired,
              should_be_active: shouldBeActive
            };
          })
        }
      }
    });
  } catch (error: any) {
    console.error('Error debugging addons:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to debug addons',
        stack: error.stack 
      },
      { status: 500 }
    );
  }
}

