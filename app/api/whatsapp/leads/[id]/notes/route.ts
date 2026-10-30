export const dynamic = 'force-dynamic';

/**
 * GET    /api/whatsapp/leads/:id/notes               - { notes }, the lead's comments newest first
 * POST   /api/whatsapp/leads/:id/notes               - { note_text } adds a comment (also shown on the lead's chat)
 * DELETE /api/whatsapp/leads/:id/notes?note_id=      - the author or a supervisor deletes a comment
 * A lead the caller cannot see is a 404. Author and business always come from the session.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { addLeadNote, deleteNote, listLeadNotes, NoteError } from '@/lib/leads/notes';

function failed(error: any, where: string) {
  if (error instanceof NoteError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(`[leads] notes ${where} error:`, error);
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: 'read' }, async ({ params, businessId, userId }) => {
  try {
    const notes = await listLeadNotes(await getInboxViewer({ businessId, userId }), params.id);
    if (!notes) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    return NextResponse.json({ notes });
  } catch (error: any) {
    return failed(error, 'GET');
  }
});

export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, inboxPermission: 'update' },
  async ({ params, businessId, userId, body }) => {
    try {
      const text = (body as { note_text?: unknown } | null)?.note_text;
      const note = await addLeadNote(await getInboxViewer({ businessId, userId }), params.id, text);
      return NextResponse.json({ note }, { status: 201 });
    } catch (error: any) {
      return failed(error, 'POST');
    }
  },
);

export const DELETE = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: 'update' }, async ({ request, businessId, userId }) => {
  try {
    const noteId = new URL(request.url).searchParams.get('note_id') || '';
    await deleteNote(await getInboxViewer({ businessId, userId }), noteId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return failed(error, 'DELETE');
  }
});
