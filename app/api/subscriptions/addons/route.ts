import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { getBusinessAddons } from '@/lib/subscription';
import * as db from '@/lib/db';

/**
 * GET /api/subscriptions/addons
 * List available WhatsApp add-ons
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    // Available add-ons definition
    const availableAddons = [
      {
        id: 'whatsapp_bot',
        name: 'WhatsApp Bot',
        display_name: 'WhatsApp Bot & Conversations',
        description: 'Access to WhatsApp Conversations, Bot Rules, and advanced automation features',
        price_monthly: 499, // INR
        currency: 'INR',
        features: [
          'Conversations management',
          'Bot Rules & Automation',
          'Message labeling',
          'Auto-replies',
          'CRM integration',
        ],
      },
      {
        id: 'whatsapp_send_message',
        name: 'Send Message',
        display_name: 'WhatsApp Send Message',
        description: 'Send custom WhatsApp messages, button messages, and media to customers',
        price_monthly: 299, // INR
        currency: 'INR',
        features: [
          'Send text messages',
          'Send button messages',
          'Send media (images, documents)',
          'Message scheduling',
        ],
      },
    ];

    // Get current active add-ons for this business
    const activeAddons = await getBusinessAddons(businessId);
    const activeAddonTypes = new Set(activeAddons.map(a => a.addon_type));

    // Mark which addons are active
    const addonsWithStatus = availableAddons.map(addon => ({
      ...addon,
      isActive: activeAddonTypes.has(addon.id as any),
      activeAddon: activeAddons.find(a => a.addon_type === addon.id),
    }));

    return NextResponse.json({
      addons: addonsWithStatus,
      activeAddons,
    });
  } catch (error: any) {
    console.error('Error fetching addons:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch addons' },
      { status: 500 }
    );
  }
}

