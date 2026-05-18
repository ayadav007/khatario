'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { User, Phone, Mail, MapPin, Calendar, Tag, Loader2, Save, Plus, X, TrendingUp, Flame } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { NotesSection } from './NotesSection';
import { AutomationTimeline, TimelineEvent } from './AutomationTimeline';
import { LabelManagerModal } from '../labels/LabelManagerModal';
import { Toast } from '@/components/ui/Toast';
import { LinkedOrdersCard } from './LinkedOrdersCard';

interface ContactInfo {
  conversation_id: string;
  phone: string;
  whatsapp_id: string;
  first_seen: string;
  last_seen: string;
  source: string;
  total_messages: number;
  first_message_at: string;
  profile_picture_url?: string | null;
  customer?: {
    id: string;
    name: string;
    phone: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
  } | null;
}

interface CustomFields {
  [key: string]: string;
}

interface ContactPanelProps {
  conversationId: string;
  businessId: string;
  currentUserId?: string;
  contact?: ContactInfo | null;
  notes: Array<{
    id: string;
    note_text: string;
    created_at: string;
    user_id: string;
    user_name?: string;
    user_email?: string;
  }>;
  timeline: TimelineEvent[];
  customFields: CustomFields;
  assignedTo?: string | null;
  leadStatus?: string;
  conversationStatus?: string;
  onUpdate: (updates: { assigned_to?: string | null; lead_status?: string; conversation_status?: string }) => Promise<void>;
  onNoteAdded?: () => void | Promise<void>;
  onNoteDeleted?: () => void | Promise<void>;
  loading?: boolean;
  leadProfile?: any; // AI-generated lead profile
}

export function ContactPanel({
  conversationId,
  businessId,
  currentUserId,
  contact,
  notes,
  timeline,
  customFields: initialCustomFields,
  assignedTo,
  leadStatus,
  conversationStatus,
  onUpdate,
  onNoteAdded,
  onNoteDeleted,
  loading = false,
  leadProfile
}: ContactPanelProps) {
  const [customFields, setCustomFields] = useState<CustomFields>(initialCustomFields);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<Array<{ id: string; name: string; email?: string }>>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showLabelManagerModal, setShowLabelManagerModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' | 'warning' } | null>(null);

  useEffect(() => {
    setCustomFields(initialCustomFields);
  }, [initialCustomFields]);

  useEffect(() => {
    // Fetch users for assignment dropdown
    const fetchUsers = async () => {
      setLoadingUsers(true);
      try {
        const res = await fetch(`/api/whatsapp/users?business_id=${businessId}`);
        if (res.ok) {
          const data = await res.json();
          setUsers(data.users || []);
        }
      } catch (error) {
        console.error('Error fetching users:', error);
      } finally {
        setLoadingUsers(false);
      }
    };
    fetchUsers();
  }, [businessId]);

  const handleSaveField = async (key: string, value: string) => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/custom-fields?business_id=${businessId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: { ...customFields, [key]: value }
          })
        }
      );

      if (res.ok) {
        const data = await res.json();
        setCustomFields(data.fields);
        setEditingField(null);
      }
    } catch (error) {
      console.error('Error saving field:', error);
      setToast({ message: 'Failed to save field', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleAddField = async () => {
    if (!newFieldKey.trim()) return;
    await handleSaveField(newFieldKey.trim(), newFieldValue.trim());
    setNewFieldKey('');
    setNewFieldValue('');
  };

  const handleDeleteField = async (key: string) => {
    try {
      const encodedKey = encodeURIComponent(key);
      const res = await fetch(
        `/api/whatsapp/conversations/${conversationId}/custom-fields/${encodedKey}?business_id=${businessId}`,
        { method: 'DELETE' }
      );

      if (res.ok) {
        const updated = { ...customFields };
        delete updated[key];
        setCustomFields(updated);
      } else {
        const error = await res.json();
        setToast({ message: error.error || 'Failed to delete field', type: 'error' });
      }
    } catch (error) {
      console.error('Error deleting field:', error);
      setToast({ message: 'Failed to delete field', type: 'error' });
    }
  };

  const formatPhoneNumber = (phone: string): string => {
    if (!phone) return 'Unknown';
    const clean = phone.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    if (clean.length === 12) {
      return `+${clean.slice(0, 2)} ${clean.slice(2, 7)} ${clean.slice(7)}`;
    }
    if (clean.length === 10) {
      return `${clean.slice(0, 5)} ${clean.slice(5)}`;
    }
    return clean;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200" style={{ minHeight: 0, overflow: 'hidden' }}>
      <div className="p-4 space-y-6 overflow-y-auto h-full" style={{ minHeight: 0 }}>
        {/* Section 1: Contact Info */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Contact Info</h3>
          <div className="space-y-3">
            {/* Avatar and Name */}
            <div className="flex items-center gap-3">
              {contact?.profile_picture_url ? (
                <img 
                  src={contact.profile_picture_url} 
                  alt="Profile"
                  className="w-12 h-12 rounded-full object-cover border-2 border-gray-200"
                  onError={(e) => {
                    // Fallback to initials if image fails to load
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent) {
                      const fallback = parent.querySelector('.avatar-fallback') as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }
                  }}
                />
              ) : null}
              <div 
                className={`w-12 h-12 rounded-xl bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-md avatar-fallback ${contact?.profile_picture_url ? 'hidden' : ''}`}
              >
                {contact?.customer?.name?.charAt(0)?.toUpperCase() || contact?.phone?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  {contact?.customer?.name || formatPhoneNumber(contact?.phone || '')}
                </p>
                {contact?.customer?.email && (
                  <p className="text-sm text-gray-500">{contact.customer.email}</p>
                )}
              </div>
            </div>

            {/* Lead Profile Mini View */}
            {leadProfile && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">Lead Score</span>
                  <span className={`text-sm font-bold ${
                    leadProfile.lead_score >= 70 ? 'text-green-600' : 
                    leadProfile.lead_score >= 40 ? 'text-yellow-600' : 
                    'text-red-600'
                  }`}>
                    {leadProfile.lead_score}/100
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">Status</span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    leadProfile.lead_status === 'hot' ? 'bg-red-100 text-red-700' :
                    leadProfile.lead_status === 'warm' ? 'bg-orange-100 text-orange-700' :
                    leadProfile.lead_status === 'cold' ? 'bg-slate-100 text-primary-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>
                    {leadProfile.lead_status?.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-600">Purchase Intent</span>
                  <span className="text-sm font-semibold text-primary-600">{leadProfile.purchase_intent}%</span>
                </div>
                {leadProfile.behavior_tags && leadProfile.behavior_tags.length > 0 && (
                  <div className="mt-2">
                    <span className="text-xs font-medium text-gray-600 block mb-1">Tags</span>
                    <div className="flex flex-wrap gap-1">
                      {leadProfile.behavior_tags.slice(0, 3).map((tag: string, idx: number) => (
                        <span key={idx} className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded">
                          {tag.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {contact?.customer?.id && (
                  <a 
                    href={`/customers/${contact.customer.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary-600 hover:underline mt-2 block"
                  >
                    View Full Lead Profile →
                  </a>
                )}
              </div>
            )}

            {/* Phone */}
            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">{formatPhoneNumber(contact?.phone || '')}</span>
            </div>

            {/* WhatsApp ID */}
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-400">ID:</span>
              <span className="text-gray-700 font-mono text-xs">{contact?.whatsapp_id}</span>
            </div>

            {/* Address */}
            {contact?.customer?.address && (
              <div className="flex items-start gap-2 text-sm">
                <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                <div>
                  <p className="text-gray-700">{contact.customer.address}</p>
                  {(contact.customer.city || contact.customer.state) && (
                    <p className="text-gray-500">
                      {[contact.customer.city, contact.customer.state].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* First/Last Seen */}
            <div className="space-y-1 text-xs text-gray-500 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5" />
                <span>First seen: {contact?.first_seen ? format(new Date(contact.first_seen), 'MMM d, yyyy') : 'N/A'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5" />
                <span>Last seen: {contact?.last_seen ? format(new Date(contact.last_seen), 'MMM d, yyyy') : 'N/A'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5" />
                <span>Source: {contact?.source || 'Unknown'}</span>
              </div>
              <div>
                <span>Messages: {contact?.total_messages || 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Lead Management */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Lead Management</h3>
          <div className="space-y-4">
            {/* Lead Status (AI-based with manual override) */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Lead Status
                {leadProfile && (
                  <span className="text-xs text-gray-500 ml-1">
                    (AI: {leadProfile.lead_status || 'not analyzed'})
                  </span>
                )}
              </label>
              <select
                value={leadProfile?.lead_status || leadStatus || 'cold'}
                onChange={(e) => onUpdate({ lead_status: e.target.value })}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="hot">🔥 Hot Lead</option>
                <option value="warm">🟡 Warm Lead</option>
                <option value="cold">🔵 Cold Lead</option>
                <option value="not_interested">❌ Not Interested</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">
                {leadProfile ? 
                  'Manual override (overrides AI analysis)' : 
                  'AI analysis will update this automatically'}
              </p>
            </div>

            {/* Assigned Agent */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Assigned Agent</label>
              <select
                value={assignedTo || ''}
                onChange={(e) => onUpdate({ assigned_to: e.target.value || null })}
                className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                disabled={loadingUsers}
              >
                <option value="">Unassigned</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Labels */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-gray-700">Labels</label>
                <button
                  onClick={() => setShowLabelManagerModal(true)}
                  className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-1.5 font-medium transition-colors"
                  title="Manage Labels"
                >
                  <Tag className="w-3.5 h-3.5" />
                  Manage
                </button>
              </div>
              <div className="text-xs text-gray-400 italic bg-gray-50 rounded-lg p-2 border border-gray-100">
                Use Label Assignment modal to assign labels to this conversation
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Linked Orders & Invoices */}
        <div className="bg-white rounded-xl overflow-hidden border border-gray-200 shadow-sm">
          <LinkedOrdersCard conversationId={conversationId} businessId={businessId} />
        </div>

        {/* Section 4: Internal Notes */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <NotesSection
            conversationId={conversationId}
            businessId={businessId}
            notes={notes}
            currentUserId={currentUserId}
            onNoteAdded={onNoteAdded || (() => {})}
            onNoteDeleted={onNoteDeleted || (() => {})}
          />
        </div>

        {/* Section 5: Automation Timeline */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Automation Timeline</h3>
          <div className="max-h-[300px] overflow-y-auto">
            <AutomationTimeline events={timeline} />
          </div>
        </div>

        {/* Section 6: Custom Fields */}
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Custom Fields</h3>
          <div className="space-y-2">
            {/* Existing fields */}
            {Object.entries(customFields).map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-xs text-gray-600 font-medium min-w-[100px]">{key}:</span>
                <Input
                  value={value || ''}
                  onChange={(e) => {
                    const updated = { ...customFields };
                    updated[key] = e.target.value;
                    setCustomFields(updated);
                    if (!editingField) setEditingField(key);
                  }}
                  onBlur={async () => {
                    if (editingField === key) {
                      await handleSaveField(key, customFields[key] || '');
                    }
                    // Small delay to allow save to complete
                    setTimeout(() => setEditingField(null), 200);
                  }}
                  onFocus={() => setEditingField(key)}
                  placeholder="Value"
                  className="flex-1 text-sm"
                />
                <button
                  onClick={() => handleDeleteField(key)}
                  className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                  title="Delete field"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}

            {/* Add new field */}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
              <Input
                value={newFieldKey}
                onChange={(e) => setNewFieldKey(e.target.value)}
                placeholder="Field name"
                className="flex-1 text-sm"
              />
              <Input
                value={newFieldValue}
                onChange={(e) => setNewFieldValue(e.target.value)}
                placeholder="Value"
                className="flex-1 text-sm"
              />
              <button
                onClick={handleAddField}
                disabled={!newFieldKey.trim() || saving}
                className="p-1.5 bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
                title="Add field"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Label Manager Modal */}
      {businessId && (
        <LabelManagerModal
          isOpen={showLabelManagerModal}
          onClose={() => setShowLabelManagerModal(false)}
          businessId={businessId}
        />
      )}

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

