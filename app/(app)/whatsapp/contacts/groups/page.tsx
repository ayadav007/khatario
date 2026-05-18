'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { 
  Loader2, Users, Plus, Edit2, Trash2, UserPlus, X, Save
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { Toast, ToastType } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/whatsapp/ConfirmDialog';

interface ContactGroup {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  color: string;
  created_at: string;
  updated_at: string;
  member_count: string;
}

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
}

export default function ContactGroupsPage() {
  const { business } = useAuth();
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ContactGroup | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<ContactGroup | null>(null);
  const [groupMembers, setGroupMembers] = useState<Contact[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    if (business?.id) {
      fetchGroups();
    }
  }, [business?.id]);

  const fetchGroups = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/whatsapp/contact-groups?business_id=${business.id}`);
      if (!response.ok) throw new Error('Failed to fetch contact groups');

      const data = await response.json();
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Error fetching contact groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupMembers = async (groupId: string) => {
    if (!business?.id) return;

    setLoadingMembers(true);
    try {
      const response = await fetch(
        `/api/whatsapp/contact-groups/${groupId}/members?business_id=${business.id}`
      );
      if (!response.ok) throw new Error('Failed to fetch group members');

      const data = await response.json();
      setGroupMembers(data.members || []);
    } catch (error) {
      console.error('Error fetching group members:', error);
    } finally {
      setLoadingMembers(false);
    }
  };

  const handleViewGroup = (group: ContactGroup) => {
    setSelectedGroup(group);
    fetchGroupMembers(group.id);
  };

  const handleDelete = (groupId: string) => {
    setConfirmDialog({
      title: 'Delete group',
      message: 'Delete this contact group? Contacts will not be deleted.',
      onConfirm: () => {
        setConfirmDialog(null);
        void (async () => {
          try {
            const response = await fetch(
              `/api/whatsapp/contact-groups?id=${groupId}&business_id=${business?.id}`,
              { method: 'DELETE' }
            );

            if (!response.ok) throw new Error('Failed to delete group');

            fetchGroups();
            if (selectedGroup?.id === groupId) {
              setSelectedGroup(null);
            }
          } catch (error) {
            console.error('Error deleting group:', error);
            setToast({ message: 'Failed to delete group', type: 'error' });
          }
        })();
      },
    });
  };

  return (
    
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
              Contact Groups
            </h1>
            <p className="text-text-secondary text-lg">
              Organize contacts into groups for campaigns
            </p>
          </div>

          <div className="flex gap-2">
            <Link href="/whatsapp/contacts">
              <Button variant="secondary" size="sm">
                Back to Contacts
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Group
            </Button>
          </div>
        </div>

        {/* Groups Grid */}
        {loading ? (
          <Card className="p-8 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            <span className="ml-3 text-text-secondary">Loading groups...</span>
          </Card>
        ) : groups.length === 0 ? (
          <Card className="p-12 text-center">
            <Users className="h-16 w-16 mx-auto mb-4 text-gray-300" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">
              No contact groups yet
            </h3>
            <p className="text-text-secondary mb-4">
              Create groups to organize your contacts for campaigns
            </p>
            <Button
              size="sm"
              onClick={() => setShowAddModal(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Group
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {groups.map((group) => (
              <Card
                key={group.id}
                className="p-4 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => handleViewGroup(group)}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGroup(group);
                        }}
                        className="text-gray-400 hover:text-primary-600 transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(group.id);
                        }}
                        className="text-gray-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-text-primary mb-1">
                      {group.name}
                    </h3>
                    {group.description && (
                      <p className="text-sm text-text-secondary line-clamp-2">
                        {group.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-sm text-text-secondary pt-2 border-t border-gray-100">
                    <Users className="h-4 w-4" />
                    <span>{group.member_count} contacts</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Add/Edit Modal */}
        {(showAddModal || editingGroup) && (
          <GroupModal
            group={editingGroup}
            businessId={business?.id || ''}
            onClose={() => {
              setShowAddModal(false);
              setEditingGroup(null);
            }}
            onSuccess={() => {
              setShowAddModal(false);
              setEditingGroup(null);
              fetchGroups();
            }}
          />
        )}

        {/* Group Members Modal */}
        {selectedGroup && (
          <GroupMembersModal
            group={selectedGroup}
            members={groupMembers}
            businessId={business?.id || ''}
            loading={loadingMembers}
            onClose={() => {
              setSelectedGroup(null);
              setGroupMembers([]);
            }}
            onRefresh={() => fetchGroupMembers(selectedGroup.id)}
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
          confirmLabel="Delete"
          onConfirm={() => confirmDialog?.onConfirm()}
          onCancel={() => setConfirmDialog(null)}
        />
      </div>
    
  );
}

// Group Add/Edit Modal Component
function GroupModal({ group, businessId, onClose, onSuccess }: any) {
  const [formData, setFormData] = useState({
    name: group?.name || '',
    description: group?.description || '',
    color: group?.color || '#25D366',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim()) {
      setError('Group name is required');
      return;
    }

    setLoading(true);
    try {
      const url = '/api/whatsapp/contact-groups';
      const method = group ? 'PUT' : 'POST';
      const body: any = {
        business_id: businessId,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        color: formData.color,
      };

      if (group) {
        body.id = group.id;
      }

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || `Failed to ${group ? 'update' : 'create'} group`);
        return;
      }

      onSuccess();
    } catch (error) {
      console.error('Error saving group:', error);
      setError('An error occurred while saving the group');
    } finally {
      setLoading(false);
    }
  };

  const colorOptions = [
    '#25D366', // WhatsApp Green
    '#3B82F6', // Blue
    '#EF4444', // Red
    '#F59E0B', // Orange
    '#8B5CF6', // Purple
    '#EC4899', // Pink
    '#10B981', // Emerald
    '#6366F1', // Indigo
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-text-primary">
            {group ? 'Edit Group' : 'New Contact Group'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
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
              Group Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., VIP Customers"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Color
            </label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setFormData({ ...formData, color })}
                  className={`w-10 h-10 rounded-full transition-all ${
                    formData.color === color
                      ? 'ring-2 ring-offset-2 ring-gray-400'
                      : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
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
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {group ? 'Update' : 'Create'} Group
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Group Members Modal Component
function GroupMembersModal({ group, members, businessId, loading, onClose, onRefresh }: any) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">{group.name}</h2>
            <p className="text-sm text-text-secondary mt-1">
              {members.length} contacts in this group
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No contacts in this group yet</p>
              <p className="text-sm mt-2">
                Add contacts from the main contacts page
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member: Contact) => (
                <div
                  key={member.id}
                  className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      {member.name && (
                        <p className="font-medium text-text-primary">{member.name}</p>
                      )}
                      <p className="text-sm text-text-secondary font-mono">{member.phone}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-gray-50">
          <Button variant="secondary" onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
