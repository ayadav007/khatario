'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { BookOpen, Lock, Plus, Search, Edit2, Trash2, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card } from '@/components/ui/Card';
import { Toast } from '@/components/ui/Toast';

interface SavedReply {
  id: string;
  title: string;
  shortcut: string | null;
  message: string;
  category: string;
  created_at: string;
}

const CATEGORIES = ['general', 'orders', 'payments', 'delivery', 'support', 'greetings'];

const EMPTY_FORM = { title: '', shortcut: '', message: '', category: 'general' };

export default function SavedRepliesPage() {
  const { business } = useAuth();
  const { hasFeature, loading: subLoading } = useSubscriptionCheck(business?.id);

  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const hasAccess = hasFeature('whatsapp_bot');

  const fetchReplies = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category', categoryFilter);
      const res = await fetch(`/api/whatsapp/saved-replies?${params}`);
      const data = await res.json();
      setReplies(data.replies || []);
    } finally {
      setLoading(false);
    }
  }, [business?.id, search, categoryFilter]);

  useEffect(() => { fetchReplies(); }, [fetchReplies]);

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
        ? `/api/whatsapp/saved-replies?business_id=${business?.id}`
        : `/api/whatsapp/saved-replies/${editingId}?business_id=${business?.id}`;
      const res = await fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to save.'); return; }
      setToast({ message: isNew ? 'Reply created!' : 'Reply updated!', type: 'success' });
      setEditingId(null);
      fetchReplies();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this saved reply?')) return;
    setDeletingId(id);
    await fetch(`/api/whatsapp/saved-replies/${id}?business_id=${business?.id}`, { method: 'DELETE' });
    setDeletingId(null);
    setReplies((prev) => prev.filter((r) => r.id !== id));
    setToast({ message: 'Reply deleted.', type: 'success' });
  };

  const startEdit = (reply: SavedReply) => {
    setForm({ title: reply.title, shortcut: reply.shortcut || '', message: reply.message, category: reply.category });
    setEditingId(reply.id);
    setError('');
  };

  if (subLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="max-w-xl mx-auto py-12 text-center">
        <Lock className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Upgrade to use Saved Replies</h2>
        <p className="text-gray-500 text-sm">Saved Replies require the WhatsApp Bot addon.</p>
      </div>
    );
  }

  const grouped = replies.reduce<Record<string, SavedReply[]>>((acc, r) => {
    const cat = r.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary-600" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Saved Replies</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Pre-written replies your team can insert with one click or by typing <code className="bg-gray-100 px-1 rounded">/shortcut</code>.
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => { setForm(EMPTY_FORM); setEditingId('new'); setError(''); }}
          className="gap-1.5"
        >
          <Plus className="w-4 h-4" /> New Reply
        </Button>
      </div>

      {/* New / edit form */}
      {editingId !== null && (
        <Card className="p-5 space-y-4 border border-primary-200 bg-slate-50/30">
          <h3 className="text-sm font-semibold text-gray-900">
            {editingId === 'new' ? 'Create New Reply' : 'Edit Reply'}
          </h3>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title *</label>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Payment received"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Shortcut (optional)</label>
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
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
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
              placeholder="Type the full reply message..."
              rows={5}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setError(''); }}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Save Reply
            </Button>
          </div>
        </Card>
      )}

      {/* Search + filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search replies…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Replies list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : replies.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <BookOpen className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">{search ? 'No results.' : 'No saved replies yet. Create your first one above.'}</p>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {cat} ({items.length})
            </h3>
            <div className="space-y-2">
              {items.map((reply) => (
                <Card key={reply.id} className="p-4 flex items-start gap-4 hover:bg-gray-50 transition-colors">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900">{reply.title}</span>
                      {reply.shortcut && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-mono">
                          /{reply.shortcut}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 whitespace-pre-wrap line-clamp-3">{reply.message}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => startEdit(reply)}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-slate-50 rounded-lg transition-colors"
                      title="Edit"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(reply.id)}
                      disabled={deletingId === reply.id}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete"
                    >
                      {deletingId === reply.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
