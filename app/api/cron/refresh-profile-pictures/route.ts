/**
 * Cron job to refresh cached profile pictures for conversations
 * that have never had a picture fetched or were last updated more than 7 days ago.
 * 
 * Call: GET /api/cron/refresh-profile-pictures?business_id=<id>&limit=20
 */
import { NextRequest, NextResponse } from 'next/server';
import { queryRows, query } from '@/lib/db';
import { fetchProfilePicture } from '@/lib/whatsapp-profile-pictures';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('business_id');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50);

  if (!businessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }

  try {
    // Find conversations without a profile picture or with a stale one (>7 days)
    const stale = await queryRows<{
      id: string;
      conversation_id: string;
      from_number: string;
      is_group: boolean;
    }>(
      `SELECT id, conversation_id, from_number, is_group
       FROM whatsapp_conversations
       WHERE business_id = $1
         AND (
           profile_picture_url IS NULL
           OR profile_picture_updated_at < NOW() - INTERVAL '7 days'
         )
       ORDER BY last_message_at DESC NULLS LAST
       LIMIT $2`,
      [businessId, limit]
    );

    let updated = 0;
    let skipped = 0;

    for (const conv of stale) {
      try {
        const jid = conv.is_group
          ? (conv.conversation_id.includes('@') ? conv.conversation_id : `${conv.conversation_id}@g.us`)
          : (conv.conversation_id.includes('@') ? conv.conversation_id : `${conv.conversation_id}@s.whatsapp.net`);

        const url = await fetchProfilePicture(businessId, jid, conv.from_number, conv.is_group);

        if (url) {
          await query(
            `UPDATE whatsapp_conversations
             SET profile_picture_url = $1, profile_picture_updated_at = NOW()
             WHERE id = $2 AND business_id = $3`,
            [url, conv.id, businessId]
          );
          updated++;
        } else {
          // Mark as checked (to avoid rechecking every time)
          await query(
            `UPDATE whatsapp_conversations
             SET profile_picture_updated_at = NOW()
             WHERE id = $1 AND business_id = $2`,
            [conv.id, businessId]
          );
          skipped++;
        }

        // Small delay to avoid rate-limiting WhatsApp
        await new Promise(r => setTimeout(r, 200));
      } catch (_) {
        skipped++;
      }
    }

    return NextResponse.json({
      processed: stale.length,
      updated,
      skipped,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
