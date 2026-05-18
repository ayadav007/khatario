import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';

// Helper function to check WhatsApp Bot addon
async function hasWhatsAppBotAddon(businessId: string): Promise<boolean> {
  try {
    const addon = await queryOne(
      `SELECT id FROM whatsapp_addons 
       WHERE business_id = $1 
       AND addon_type IN ('whatsapp_bot', 'whatsapp', 'whatsapp_send_message')
       AND status = 'active' 
       AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
      [businessId]
    );
    return !!addon;
  } catch (error) {
    console.error('Error checking WhatsApp Bot addon:', error);
    return false;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json({ error: 'WhatsApp Bot addon required' }, { status: 403 });
    }

    const config = await queryOne(
      `SELECT * FROM ai_provider_config WHERE business_id = $1`,
      [businessId]
    );

    return NextResponse.json({ config });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      business_id, 
      provider, 
      apiKey, 
      apiBaseUrl, 
      model, 
      chatbotEnabled, 
      leadAnalyzerEnabled, 
      temperature, 
      maxTokens,
      mode,
      devAllowedPhones
    } = body;

    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }

    const hasAddon = await hasWhatsAppBotAddon(business_id);
    if (!hasAddon) {
      return NextResponse.json({ error: 'WhatsApp Bot addon required' }, { status: 403 });
    }

    // Check if config exists
    const existing = await queryOne(
      `SELECT id FROM ai_provider_config WHERE business_id = $1`,
      [business_id]
    );

    // Normalize phone numbers (remove spaces, dashes, keep only digits)
    const normalizedPhones = Array.isArray(devAllowedPhones) 
      ? devAllowedPhones
          .filter(p => p && p.trim())
          .map(p => p.replace(/[^0-9]/g, ''))
      : [];
    
    const devMode = mode === 'dev' ? 'dev' : 'prod';

    if (existing) {
      // Update
      await queryRows(
        `UPDATE ai_provider_config SET
          provider = $2, api_key = $3, api_base_url = $4, model = $5,
          chatbot_enabled = $6, lead_analyzer_enabled = $7,
          temperature = $8, max_tokens = $9, mode = $10, dev_allowed_phones = $11,
          updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $1`,
        [
          business_id, 
          provider, 
          apiKey, 
          apiBaseUrl || null, 
          model || null, 
          chatbotEnabled !== false, 
          leadAnalyzerEnabled !== false, 
          temperature || 0.7, 
          maxTokens || 500,
          devMode,
          JSON.stringify(normalizedPhones)
        ]
      );
    } else {
      // Insert
      await queryRows(
        `INSERT INTO ai_provider_config (
          business_id, provider, api_key, api_base_url, model,
          chatbot_enabled, lead_analyzer_enabled, temperature, max_tokens, mode, dev_allowed_phones
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          business_id, 
          provider, 
          apiKey, 
          apiBaseUrl || null, 
          model || null, 
          chatbotEnabled !== false, 
          leadAnalyzerEnabled !== false, 
          temperature || 0.7, 
          maxTokens || 500,
          devMode,
          JSON.stringify(normalizedPhones)
        ]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error saving AI config:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
