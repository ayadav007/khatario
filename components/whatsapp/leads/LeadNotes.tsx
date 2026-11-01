'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { NotesSection, type Note } from '@/components/whatsapp/conversations/NotesSection';
import { useAuth } from '@/contexts/AuthContext';

/** A lead's comments in the lead drawer: the same notes the chat shows, kept with this enquiry. */
export function LeadNotes({ leadId }: { leadId: string }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const shown = useRef(leadId);
  shown.current = leadId;
  const url = `/api/whatsapp/leads/${encodeURIComponent(leadId)}/notes`;

  const load = useCallback(async () => {
    const forLead = leadId;
    const res = await fetch(url, { credentials: 'include' }).catch(() => null);
    const data = res?.ok ? await res.json().catch(() => ({})) : {};
    if (shown.current === forLead) setNotes(data.notes || []);
  }, [leadId, url]);

  useEffect(() => {
    setNotes([]);
    void load();
  }, [load]);

  return (
    <NotesSection
      notesUrl={url}
      notes={notes}
      currentUserId={user?.id}
      onNoteAdded={load}
      onNoteDeleted={load}
      title="Comments"
    />
  );
}
