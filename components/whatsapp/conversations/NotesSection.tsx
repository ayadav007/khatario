'use client';

import React, { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { Toast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

export interface Note {
  id: string;
  note_text: string;
  created_at: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
}

interface NotesSectionProps {
  conversationId: string;
  businessId: string;
  notes: Note[];
  currentUserId?: string;
  onNoteAdded: () => void;
  onNoteDeleted: () => void;
}

export function NotesSection({ 
  conversationId, 
  businessId, 
  notes, 
  currentUserId,
  onNoteAdded,
  onNoteDeleted 
}: NotesSectionProps) {
  const [newNote, setNewNote] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const handleAddNote = async () => {
    if (!newNote.trim() || !currentUserId) return;

    setIsAdding(true);
    try {
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/notes?business_id=${businessId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note_text: newNote.trim(),
            user_id: currentUserId
          })
        }
      );

      if (res.ok) {
        setNewNote('');
        await onNoteAdded();
      } else {
        const error = await res.json();
        setToast({ message: error.error || 'Failed to add note', type: 'error' });
      }
    } catch (error) {
      console.error('Error adding note:', error);
      setToast({ message: 'Failed to add note', type: 'error' });
    } finally {
      setIsAdding(false);
    }
  };

  const executeDeleteNote = async (noteId: string) => {
    setDeletingId(noteId);
    try {
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/notes?business_id=${businessId}&note_id=${noteId}`,
        {
          method: 'DELETE'
        }
      );

      if (res.ok) {
        await onNoteDeleted();
      } else {
        const error = await res.json();
        setToast({ message: error.error || 'Failed to delete note', type: 'error' });
      }
    } catch (error) {
      console.error('Error deleting note:', error);
      setToast({ message: 'Failed to delete note', type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteNote = (noteId: string) => {
    setConfirmDialog({
      title: 'Confirm',
      message: 'Delete this note?',
      onConfirm: () => {
        setConfirmDialog(null);
        void executeDeleteNote(noteId);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Internal Notes</h3>
      </div>

      {/* Add note */}
      <div className="space-y-2">
        <Textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add a note..."
          rows={3}
          className="text-sm"
        />
        <Button
          onClick={handleAddNote}
          disabled={!newNote.trim() || !currentUserId || isAdding}
          size="sm"
          className="w-full"
        >
          {isAdding ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Adding...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4 mr-2" />
              Add Note
            </>
          )}
        </Button>
      </div>

      {/* Notes list */}
      <div className="space-y-3 max-h-[300px] overflow-y-auto">
        {notes.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No notes yet</p>
        ) : (
          notes.map((note) => (
            <div
              key={note.id}
              className="bg-gray-50 rounded-lg p-3 border border-gray-200"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 whitespace-pre-wrap break-words">
                    {note.note_text}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-gray-500">
                      {note.user_name || note.user_email || 'Unknown'}
                    </span>
                    <span className="text-xs text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                    </span>
                  </div>
                </div>
                {note.user_id === currentUserId && (
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    disabled={deletingId === note.id}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors flex-shrink-0"
                    title="Delete note"
                  >
                    {deletingId === note.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
      <ConfirmDialog
        isOpen={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        variant="danger"
        confirmLabel="Delete"
        onConfirm={() => {
          confirmDialog?.onConfirm();
        }}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
}

