'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { X, Loader2, Save, Trash2, Phone, Mail, Tag, Calendar } from 'lucide-react';

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  tags: string[];
  notes: string | null;
  custom_fields: Record<string, any>;
  source: string;
  created_at: string;
  groups?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
}

interface ContactDetailsModalProps {
  contact: Contact;
  businessId: string;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}

export function ContactDetailsModal({ contact, businessId, onClose, onUpdate, onDelete }: ContactDetailsModalProps) {
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    name: contact.name || '',
    email: contact.email || '',
    tags: contact.tags.join(', '),
    notes: contact.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleUpdate = async () => {
    setLoading(true);
    setError('');

    try {
      const tagsArray = formData.tags
        ? formData.tags.split(',').map(t => t.trim()).filter(t => t)
        : [];

      const response = await fetch('/api/whatsapp/contacts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: contact.id,
          business_id: businessId,
          name: formData.name || null,
          email: formData.email || null,
          tags: tagsArray,
          notes: formData.notes || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to update contact');
        return;
      }

      setEditing(false);
      onUpdate();
    } catch (error) {
      console.error('Error updating contact:', error);
      setError('An error occurred while updating the contact');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-text-primary">Contact Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
              {error}
            </div>
          )}

          {/* Phone (Read-only) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Phone Number
            </label>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <Phone className="h-4 w-4 text-gray-500" />
              <span className="font-mono text-text-primary">{contact.phone}</span>
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Name
            </label>
            {editing ? (
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Contact name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            ) : (
              <p className="text-text-primary">{contact.name || '-'}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            {editing ? (
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="contact@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            ) : (
              <div className="flex items-center gap-2">
                {contact.email ? (
                  <>
                    <Mail className="h-4 w-4 text-gray-500" />
                    <span className="text-text-primary">{contact.email}</span>
                  </>
                ) : (
                  <span className="text-gray-500">-</span>
                )}
              </div>
            )}
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Tags
            </label>
            {editing ? (
              <>
                <input
                  type="text"
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="customer, vip, lead (comma-separated)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Separate multiple tags with commas
                </p>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                {contact.tags && contact.tags.length > 0 ? (
                  contact.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="inline-flex items-center gap-1 px-2 py-1 text-sm bg-gray-100 text-gray-700 rounded"
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-gray-500">No tags</span>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Notes
            </label>
            {editing ? (
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional notes about this contact"
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
            ) : (
              <p className="text-text-primary whitespace-pre-wrap">
                {contact.notes || '-'}
              </p>
            )}
          </div>

          {/* Groups */}
          {contact.groups && contact.groups.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Groups
              </label>
              <div className="flex flex-wrap gap-2">
                {contact.groups.map((group) => (
                  <span
                    key={group.id}
                    className="inline-flex items-center px-3 py-1 text-sm rounded"
                    style={{
                      backgroundColor: group.color + '20',
                      color: group.color,
                    }}
                  >
                    {group.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="pt-4 border-t border-gray-200 space-y-2 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>
                Added on {new Date(contact.created_at).toLocaleDateString()} via{' '}
                <span className="capitalize">{contact.source.replace('_', ' ')}</span>
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            {editing ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setFormData({
                      name: contact.name || '',
                      email: contact.email || '',
                      tags: contact.tags.join(', '),
                      notes: contact.notes || '',
                    });
                    setError('');
                  }}
                  disabled={loading}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdate}
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
                      Save Changes
                    </>
                  )}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={onDelete}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
                <Button
                  onClick={() => setEditing(true)}
                  className="flex-1"
                >
                  Edit Contact
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
