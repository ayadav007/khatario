'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { 
  Loader2, UserX, Plus, Search, Download, Trash2, Calendar, Phone
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { normalizePhone, isValidPhone } from '@/lib/utils/phone';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

interface Unsubscribe {
  id: string;
  business_id: string;
  phone: string;
  unsubscribed_at: string;
}

export default function UnsubscribesPage() {
  const { business } = useAuth();
  const [unsubscribes, setUnsubscribes] = useState<Unsubscribe[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (business?.id) {
      fetchUnsubscribes();
    }
  }, [business?.id]);

  const fetchUnsubscribes = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      setError(null);
      const response = await fetch(`/api/whatsapp/unsubscribes?business_id=${business.id}`);
      if (!response.ok) throw new Error('Failed to fetch unsubscribes');

      const data = await response.json();
      setUnsubscribes(data.unsubscribes || []);
    } catch (error) {
      console.error('Error fetching unsubscribes:', error);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (phone: string) => {
    setConfirmDialog({
      title: 'Resubscribe contact?',
      message: 'Remove this number from unsubscribe list? They will receive messages again.',
      onConfirm: () => {
        setConfirmDialog(null);
        void (async () => {
          try {
            const response = await fetch(
              `/api/whatsapp/unsubscribes?business_id=${business?.id}&phone=${phone}`,
              { method: 'DELETE' }
            );

            if (!response.ok) throw new Error('Failed to remove from unsubscribe list');

            fetchUnsubscribes();
          } catch (error) {
            console.error('Error removing from unsubscribe list:', error);
            setToast({ message: 'Failed to remove from unsubscribe list', type: 'error' });
          }
        })();
      },
    });
  };

  const handleExport = () => {
    const csvHeader = 'Phone,Unsubscribed At\n';
    const csvContent = unsubscribes.map(u => {
      return `"${u.phone}","${new Date(u.unsubscribed_at).toLocaleString()}"`;
    }).join('\n');

    const blob = new Blob([csvHeader + csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unsubscribes-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const filteredUnsubscribes = unsubscribes.filter(u =>
    u.phone.includes(search)
  );
  const totalCount = filteredUnsubscribes.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const paginatedUnsubscribes = filteredUnsubscribes.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(totalCount / PAGE_SIZE) || 1);
    if (page > tp) setPage(tp);
  }, [totalCount, page]);

  return (
    
      <div className="space-y-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
              Unsubscribed Contacts
            </h1>
            <p className="text-text-secondary text-lg">
              Manage users who have opted out of messages
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExport}
              disabled={unsubscribes.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Manually
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={() => fetchUnsubscribes()} className="text-sm text-red-700 font-medium hover:underline">Retry</button>
          </div>
        )}

        {/* Search */}
        <Card className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by phone number..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
            <div className="text-sm text-text-secondary">
              {filteredUnsubscribes.length} total
            </div>
          </div>
        </Card>

        {/* List */}
        {loading ? (
          <Card className="p-8 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            <span className="ml-3 text-text-secondary">Loading...</span>
          </Card>
        ) : filteredUnsubscribes.length === 0 ? (
          <Card className="p-12 text-center">
            <UserX className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              {search ? 'No matches found' : 'No unsubscribed contacts'}
            </h3>
            <p className="text-text-secondary">
              {search
                ? 'Try a different search term'
                : 'Users who unsubscribe will appear here'
              }
            </p>
          </Card>
        ) : (
          <>
          <div className="space-y-2">
            {paginatedUnsubscribes.map((unsubscribe) => (
              <Card key={unsubscribe.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-gray-400" />
                      <span className="font-mono text-text-primary font-medium">
                        {unsubscribe.phone}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2 text-sm text-text-secondary">
                      <Calendar className="h-3 w-3" />
                      <span>
                        Unsubscribed on {new Date(unsubscribe.unsubscribed_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleDelete(unsubscribe.phone)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Resubscribe
                  </Button>
                </div>
              </Card>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <p className="text-sm text-gray-600">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 text-sm border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          </>
        )}

        {/* Add Modal */}
        {showAddModal && (
          <AddUnsubscribeModal
            businessId={business?.id || ''}
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false);
              fetchUnsubscribes();
            }}
          />
        )}
        {toast && (
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        )}
        <ConfirmDialog
          isOpen={!!confirmDialog}
          title={confirmDialog?.title || ''}
          message={confirmDialog?.message || ''}
          variant="danger"
          confirmLabel="Remove"
          onConfirm={() => confirmDialog?.onConfirm()}
          onCancel={() => setConfirmDialog(null)}
        />
      </div>
    
  );
}

// Add Unsubscribe Modal Component
function AddUnsubscribeModal({ businessId, onClose, onSuccess }: any) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalizedPhone = normalizePhone(phone);
    if (!isValidPhone(normalizedPhone)) {
      setError('Please enter a valid phone number');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/whatsapp/unsubscribes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          phone: normalizedPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to add to unsubscribe list');
        return;
      }

      onSuccess();
    } catch (error) {
      console.error('Error adding to unsubscribe list:', error);
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-text-primary">
            Add to Unsubscribe List
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g., 919876543210"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              Enter with country code (e.g., 91 for India)
            </p>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={loading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="flex-1"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add to List'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
