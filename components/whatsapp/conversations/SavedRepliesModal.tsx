'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Edit2, Trash2, X, Check, BookOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';

interface SavedReply {
  id: string;
  title: string;
  shortcut: string | null;
  message: string;
  category: string;
  created_at: string;
}

interface SavedRepliesModalProps {
  businessId: string;
  onSelect: (message: string) => void;
  onClose: () => void;
  /** If true, show manage (add/edit/delete). Default: picker mode only. */
  manageMode?: boolean;
}

const CATEGORIES = ['general', 'orders', 'payments', 'delivery', 'support', 'greetings'];

export function SavedRepliesModal({
  businessId,
  onSelect,
  onClose,
  manageMode = false,
}: SavedRepliesModalProps) {
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState({ title: '', shortcut: '', message: '', category: 'general' });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const fetchReplies = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: businessId });
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category', categoryFilter);
      const res = await fetch(`/api/whatsapp/saved-replies?${params}`);
      const data = await res.json();
      setReplies(data.replies || []);
    } catch {
      setError('Failed to load saved replies.');
    } finally {
      setLoading(false);
    }
  }, [businessId, search, categoryFilter]);

  useEffect(() => {
    fetchReplies();
  }, [fetchReplies]);

  const handleSave = async () => {
    if (!form.title.trim() || !form.message.trim()) {
      setError('Title and message are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const isNew = editingId === 'new';
      const url = isNew
        ? `/api/whatsapp/saved-replies?business_id=${businessId}`
        : `/api/whatsapp/saved-replies/${editingId}?business_id=${businessId}`;
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save.'); return; }
      setEditingId(null);
      fetchReplies();
    } catch {
      setError('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await fetch(`/api/whatsapp/saved-replies/${id}?business_id=${businessId}`, { method: 'DELETE' });
      setReplies((prev) => prev.filter((r) => r.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const startEdit = (reply: SavedReply) => {
    setForm({ title: reply.title, shortcut: reply.shortcut || '', message: reply.message, category: reply.category });
    setEditingId(reply.id);
    setError('');
  };

  const startNew = () => {
    setForm({ title: '', shortcut: '', message: '', category: 'general' });
    setEditingId('new');
    setError('');
  };

  const grouped = replies.reduce<Record<string, SavedReply[]>>((acc, r) => {
    const cat = r.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary-600" />
            <h2 className="text-base font-semibold text-gray-900">
              {manageMode ? 'Manage Saved Replies' : 'Saved Replies'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {manageMode && (
              <Button size="sm" variant="primary" onClick={startNew} className="gap-1">
                <Plus className="w-4 h-4" /> New
              </Button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Inline form (new or edit) */}
        {editingId !== null && (
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Payment received"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Shortcut</label>
                <Input
                  value={form.shortcut}
                  onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
                  placeholder="e.g. payment"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Message *</label>
              <Textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="Type the reply message..."
                rows={4}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setError(''); }}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={handleSave} disabled={saving} className="gap-1">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save
              </Button>
            </div>
          </div>
        )}

        {/* Search + filter */}
        <div className="px-5 py-3 border-b border-gray-100 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search replies..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none text-gray-600"
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Replies list */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : replies.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-400 text-sm gap-2">
              <BookOpen className="w-8 h-8 text-gray-300" />
              {search ? 'No replies match your search.' : 'No saved replies yet. Add one above.'}
            </div>
          ) : (
            Object.entries(grouped).map(([cat, items]) => (
              <div key={cat} className="mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-1">
                  {cat}
                </p>
                {items.map((reply) => (
                  <div
                    key={reply.id}
                    className="group flex items-start gap-2 px-3 py-3 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => !manageMode && onSelect(reply.message)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{reply.title}</span>
                        {reply.shortcut && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">
                            /{reply.shortcut}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{reply.message}</p>
                    </div>
                    {manageMode ? (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); startEdit(reply); }}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-slate-50 rounded-lg"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(reply.id); }}
                          disabled={deletingId === reply.id}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          {deletingId === reply.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-primary-600 font-medium shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        Use
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
