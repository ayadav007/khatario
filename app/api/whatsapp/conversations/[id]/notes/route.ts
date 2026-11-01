export const dynamic = 'force-dynamic';

/**
 * Internal notes on a chat (lib/leads/notes.ts).
 * GET    - { notes }: the chat's notes and those of any lead linked to it, newest first, each tagged with its enquiry
 * POST   - { note_text }: files under the chat's open lead, else a general chat note
 * DELETE - ?note_id=: the author or a supervisor deletes a note
 * Author and business always come from the session.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import { addChatNote, deleteNote, listChatNotes, NoteError } from '@/lib/leads/notes';

function failed(error: any, where: string) {
  if (error instanceof NoteError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(`Error ${where} note:`, error);
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: true }, async ({ params, businessId, userId }) => {
  try {
    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    return NextResponse.json({ notes: await listChatNotes(found.viewer, found.id) });
  } catch (error: any) {
    return failed(error, 'fetching');
  }
});

export const POST = withWhatsAppPremiumApi<{ id: string }>({ parseJsonBody: true, inboxPermission: true }, async ({ params, businessId, body, userId }) => {
  try {
    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    const note = await addChatNote(found.viewer, found.id, (body as { note_text?: unknown } | null)?.note_text);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error: any) {
    return failed(error, 'creating');
  }
});

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: true }, async ({ params, request, businessId, userId }) => {
  try {
    const noteId = new URL(request.url).searchParams.get('note_id');
    if (!noteId) return NextResponse.json({ error: 'note_id is required' }, { status: 400 });
    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    await deleteNote(found.viewer, noteId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return failed(error, 'deleting');
  }
});
