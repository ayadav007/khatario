'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { 
  Loader2, Users, Plus, Upload, Download, Search, Filter,
  UserPlus, Trash2, FolderPlus
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AddContactModal } from '@/components/whatsapp/contacts/AddContactModal';
import { ImportContactsModal } from '@/components/whatsapp/contacts/ImportContactsModal';
import { ContactCard } from '@/components/whatsapp/contacts/ContactCard';
import { ContactDetailsModal } from '@/components/whatsapp/contacts/ContactDetailsModal';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

interface Contact {
  id: string;
  business_id: string;
  phone: string;
  name: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  custom_fields: Record<string, any>;
  source: string;
  imported_from_group: string | null;
  created_at: string;
  updated_at: string;
  groups?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
}

export default function ContactsPage() {
  const { business } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 20;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  useEffect(() => {
    if (business?.id) {
      fetchContacts();
    }
  }, [business?.id, search, sourceFilter, groupFilter, page]);

  const fetchContacts = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      setError(null);
      const params = new URLSearchParams({
        business_id: business.id,
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      });

      if (search) params.append('search', search);
      if (sourceFilter) params.append('source', sourceFilter);
      if (groupFilter) params.append('group_id', groupFilter);

      const response = await fetch(`/api/whatsapp/contacts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch contacts');

      const data = await response.json();
      const list = data.contacts || [];
      setContacts(list);
      setTotalCount(
        data.pagination?.total ??
          data.total ??
          data.count ??
          (list.length === PAGE_SIZE
            ? page * PAGE_SIZE + 1
            : (page - 1) * PAGE_SIZE + list.length)
      );
    } catch (error) {
      console.error('Error fetching contacts:', error);
      setError('Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (contactId: string) => {
    setConfirmDialog({
      title: 'Delete contact',
      message: 'Are you sure you want to delete this contact?',
      confirmLabel: 'Delete',
      onConfirm: () => {
        setConfirmDialog(null);
        void (async () => {
          try {
            const response = await fetch(
              `/api/whatsapp/contacts?id=${contactId}&business_id=${business?.id}`,
              { method: 'DELETE' }
            );

            if (!response.ok) throw new Error('Failed to delete contact');

            fetchContacts();
          } catch (error) {
            console.error('Error deleting contact:', error);
            setToast({ message: 'Failed to delete contact', type: 'error' });
          }
        })();
      },
    });
  };

  const handleBulkDelete = () => {
    if (selectedContacts.size === 0) return;
    const count = selectedContacts.size;
    setConfirmDialog({
      title: 'Delete contacts',
      message: `Delete ${count} selected contacts?`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        setConfirmDialog(null);
        void (async () => {
          for (const contactId of Array.from(selectedContacts)) {
            try {
              await fetch(
                `/api/whatsapp/contacts?id=${contactId}&business_id=${business?.id}`,
                { method: 'DELETE' }
              );
            } catch (error) {
              console.error('Error deleting contact:', error);
            }
          }

          setSelectedContacts(new Set());
          fetchContacts();
        })();
      },
    });
  };

  const handleExport = async () => {
    if (!business?.id) return;
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        limit: '100000',
        offset: '0',
      });
      if (search) params.append('search', search);
      if (sourceFilter) params.append('source', sourceFilter);
      if (groupFilter) params.append('group_id', groupFilter);

      const response = await fetch(`/api/whatsapp/contacts?${params}`);
      if (!response.ok) throw new Error('Failed to fetch contacts for export');
      const data = await response.json();
      const rows = data.contacts || [];

      const csvHeader = 'Phone,Name,Email,Tags,Source,Created At\n';
      const csvContent = rows.map((c: Contact) => {
        return `"${c.phone}","${c.name || ''}","${c.email || ''}","${(c.tags || []).join('; ')}","${c.source}","${new Date(c.created_at).toLocaleDateString()}"`;
      }).join('\n');

      const blob = new Blob([csvHeader + csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whatsapp-contacts-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting contacts:', error);
      setToast({ message: 'Failed to export contacts', type: 'error' });
    }
  };

  const toggleSelect = (contactId: string) => {
    const newSelected = new Set(selectedContacts);
    if (newSelected.has(contactId)) {
      newSelected.delete(contactId);
    } else {
      newSelected.add(contactId);
    }
    setSelectedContacts(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedContacts.size === contacts.length) {
      setSelectedContacts(new Set());
    } else {
      setSelectedContacts(new Set(contacts.map(c => c.id)));
    }
  };

  return (
    
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
              WhatsApp Contacts
            </h1>
            <p className="text-text-secondary text-lg">
              Manage your contacts for campaigns and messaging
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleExport()}
              disabled={totalCount === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowImportModal(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Contact
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between">
            <p className="text-sm text-red-600">{error}</p>
            <button onClick={() => fetchContacts()} className="text-sm text-red-700 font-medium hover:underline">Retry</button>
          </div>
        )}

        {/* Filters & Search */}
        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, phone, or email..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>

            <select
              value={sourceFilter}
              onChange={(e) => {
                setSourceFilter(e.target.value);
                setPage(1);
              }}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Sources</option>
              <option value="manual">Manual</option>
              <option value="csv">CSV Import</option>
              <option value="group_extractor">Group Extractor</option>
            </select>
          </div>

          {/* Stats */}
          <div className="mt-4 flex items-center gap-6 text-sm text-text-secondary">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>{totalCount} contacts</span>
            </div>
            {selectedContacts.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-primary-600">
                  {selectedContacts.size} selected
                </span>
              </div>
            )}
          </div>
        </Card>

        {/* Bulk Actions */}
        {selectedContacts.size > 0 && (
          <Card className="p-4 bg-slate-50 border-primary-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-primary">
                {selectedContacts.size} contact(s) selected
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedContacts(new Set())}
                >
                  Cancel
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  onClick={handleBulkDelete}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Contacts List */}
        {loading ? (
          <Card className="p-8 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            <span className="ml-3 text-text-secondary">Loading contacts...</span>
          </Card>
        ) : contacts.length === 0 ? (
          <Card className="p-12 text-center">
            <Users className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              {totalCount === 0 && !search && !sourceFilter && !groupFilter
                ? 'No contacts yet'
                : 'No contacts match your filters'}
            </h3>
            <p className="text-text-secondary mb-4">
              {totalCount === 0 && !search && !sourceFilter && !groupFilter
                ? 'Add contacts manually or import from CSV or WhatsApp groups'
                : 'Try adjusting search or filters'}
            </p>
            {totalCount === 0 && !search && !sourceFilter && !groupFilter && (
              <div className="flex gap-2 justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowImportModal(true)}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import Contacts
                </Button>
                <Button
                  size="sm"
                  onClick={() => setShowAddModal(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Contact
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                selected={selectedContacts.has(contact.id)}
                onSelect={() => toggleSelect(contact.id)}
                onClick={() => setSelectedContact(contact)}
                onDelete={() => handleDelete(contact.id)}
              />
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

        {/* Modals */}
        {showAddModal && (
          <AddContactModal
            businessId={business?.id || ''}
            onClose={() => setShowAddModal(false)}
            onSuccess={() => {
              setShowAddModal(false);
              fetchContacts();
            }}
          />
        )}

        {showImportModal && (
          <ImportContactsModal
            businessId={business?.id || ''}
            onClose={() => setShowImportModal(false)}
            onSuccess={() => {
              setShowImportModal(false);
              fetchContacts();
            }}
          />
        )}

        {selectedContact && (
          <ContactDetailsModal
            contact={selectedContact}
            businessId={business?.id || ''}
            onClose={() => setSelectedContact(null)}
            onUpdate={() => {
              setSelectedContact(null);
              fetchContacts();
            }}
            onDelete={() => {
              handleDelete(selectedContact.id);
              setSelectedContact(null);
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
          confirmLabel={confirmDialog?.confirmLabel || 'Delete'}
          onConfirm={() => confirmDialog?.onConfirm()}
          onCancel={() => setConfirmDialog(null)}
        />
      </div>
    
  );
}
