export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import {
  intervene,
  loadOwnership,
  OwnershipError,
  resolve,
  takeOver,
  transfer,
} from '@/lib/whatsapp/inbox-ownership';

/**
 * POST /api/whatsapp/conversations/[id]/ownership
 * `{ action: 'intervene' | 'transfer' | 'take_over' | 'resolve', to_user_id? }`
 */
export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { inboxPermission: 'update', parseJsonBody: true },
  async ({ params, businessId, userId, body }) => {
    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const { action, to_user_id } = (body ?? {}) as { action?: string; to_user_id?: unknown };
    try {
      switch (action) {
        case 'intervene':
          await intervene(found.viewer, found.id);
          break;
        case 'take_over':
          await takeOver(found.viewer, found.id);
          break;
        case 'resolve':
          await resolve(found.viewer, found.id);
          break;
        case 'transfer':
          if (typeof to_user_id !== 'string' || !to_user_id) {
            return NextResponse.json({ error: 'to_user_id is required' }, { status: 400 });
          }
          await transfer(found.viewer, found.id, to_user_id);
          break;
        default:
          return NextResponse.json(
            { error: "action must be 'intervene', 'transfer', 'take_over' or 'resolve'" },
            { status: 400 },
          );
      }
      const row = await loadOwnership(businessId, found.id);
      return NextResponse.json({
        success: true,
        inbox_state: row?.inbox_state,
        assigned_to: row?.inbox_state === 'intervened' ? row.assigned_to : null,
        owner_name: row?.inbox_state === 'intervened' ? row.owner_name : null,
      });
    } catch (error) {
      if (error instanceof OwnershipError) {
        return NextResponse.json(
          { error: error.message, code: error.code, owner_name: error.ownerName ?? null },
          { status: error.status },
        );
      }
      console.error('[inbox-ownership] action failed:', error);
      return NextResponse.json({ error: 'Could not update this chat' }, { status: 500 });
    }
  },
);
