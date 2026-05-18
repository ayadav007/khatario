'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { X, Loader2, Users, CheckSquare, Square } from 'lucide-react';
import { Toast, ToastType } from '@/components/ui/Toast';

interface ContactGroup {
  id: string;
  name: string;
  description: string | null;
  color: string;
  member_count: string;
}

interface Contact {
  id: string;
  phone: string;
  name: string | null;
}

interface ContactGroupSelectorProps {
  businessId: string;
  onClose: () => void;
  onSelect: (contacts: Array<{ phone: string; name?: string }>) => void;
}

export function ContactGroupSelector({ businessId, onClose, onSelect }: ContactGroupSelectorProps) {
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  useEffect(() => {
    fetchGroups();
  }, [businessId]);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/whatsapp/contact-groups?business_id=${businessId}`);
      if (!response.ok) throw new Error('Failed to fetch groups');

      const data = await response.json();
      setGroups(data.groups || []);
    } catch (error) {
      console.error('Error fetching groups:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (groupId: string) => {
    const newSelected = new Set(selectedGroups);
    if (newSelected.has(groupId)) {
      newSelected.delete(groupId);
    } else {
      newSelected.add(groupId);
    }
    setSelectedGroups(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedGroups.size === groups.length) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(groups.map(g => g.id)));
    }
  };

  const handleImport = async () => {
    if (selectedGroups.size === 0) return;

    setLoadingContacts(true);
    try {
      const allContacts: Array<{ phone: string; name?: string }> = [];
      const seenPhones = new Set<string>();

      // Fetch contacts from each selected group
      for (const groupId of Array.from(selectedGroups)) {
        const response = await fetch(
          `/api/whatsapp/contact-groups/${groupId}/members?business_id=${businessId}`
        );
        
        if (!response.ok) continue;

        const data = await response.json();
        const members: Contact[] = data.members || [];

        // Add unique contacts
        for (const member of members) {
          if (!seenPhones.has(member.phone)) {
            seenPhones.add(member.phone);
            allContacts.push({
              phone: member.phone,
              name: member.name || undefined,
            });
          }
        }
      }

      onSelect(allContacts);
    } catch (error) {
      console.error('Error fetching group members:', error);
      setToast({ message: 'Failed to fetch group members', type: 'error' });
    } finally {
      setLoadingContacts(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-text-primary">Select Contact Groups</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No contact groups found</p>
              <p className="text-sm mt-2">
                Create groups in the Contacts section first
              </p>
            </div>
          ) : (
            <>
              {/* Select All */}
              <div className="flex items-center justify-between mb-4 pb-4 border-b">
                <button
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700"
                >
                  {selectedGroups.size === groups.length ? (
                    <CheckSquare className="h-4 w-4" />
                  ) : (
                    <Square className="h-4 w-4" />
                  )}
                  {selectedGroups.size === groups.length ? 'Deselect All' : 'Select All'}
                </button>
                <span className="text-sm text-gray-600">
                  {selectedGroups.size} selected
                </span>
              </div>

              {/* Groups List */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    onClick={() => toggleGroup(group.id)}
                    className={`p-4 border rounded-lg cursor-pointer transition-all ${
                      selectedGroups.has(group.id)
                        ? 'border-primary-500 bg-slate-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                          selectedGroups.has(group.id)
                            ? 'bg-primary-600 border-primary-600'
                            : 'border-gray-300'
                        }`}
                      >
                        {selectedGroups.has(group.id) && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                          <h3 className="font-semibold text-text-primary">
                            {group.name}
                          </h3>
                        </div>
                        {group.description && (
                          <p className="text-sm text-text-secondary line-clamp-1">
                            {group.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-xs text-gray-600">
                          <Users className="h-3 w-3" />
                          <span>{group.member_count} contacts</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t bg-gray-50">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={loadingContacts}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={selectedGroups.size === 0 || loadingContacts}
              className="flex-1"
            >
              {loadingContacts ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Loading...
                </>
              ) : (
                `Import from ${selectedGroups.size} Group(s)`
              )}
            </Button>
          </div>
        </div>
      </div>
      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
