'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { X, Loader2, BookUser } from 'lucide-react';
import { normalizePhone, isValidPhone } from '@/lib/utils/phone';
import {
  isDeviceContactPickerAvailable,
  pickOneContactFromDevice,
} from '@/lib/utils/device-contact-picker';

interface AddContactModalProps {
  businessId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddContactModal({ businessId, onClose, onSuccess }: AddContactModalProps) {
  const [formData, setFormData] = useState({
    phone: '',
    name: '',
    email: '',
    tags: '',
    notes: '',
  });
  const [contactSource, setContactSource] = useState<'manual' | 'device_contacts'>('manual');
  const [loading, setLoading] = useState(false);
  const [pickingFromDevice, setPickingFromDevice] = useState(false);
  const [error, setError] = useState('');

  const devicePickerSupported =
    typeof window !== 'undefined' && isDeviceContactPickerAvailable();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate phone
    const normalizedPhone = normalizePhone(formData.phone);
    if (!isValidPhone(normalizedPhone)) {
      setError('Please enter a valid phone number');
      return;
    }

    setLoading(true);
    try {
      const tagsArray = formData.tags
        ? formData.tags.split(',').map(t => t.trim()).filter(t => t)
        : [];

      const response = await fetch('/api/whatsapp/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          phone: normalizedPhone,
          name: formData.name || null,
          email: formData.email || null,
          tags: tagsArray,
          notes: formData.notes || null,
          source: contactSource,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setError('A contact with this phone number already exists');
        } else {
          setError(data.error || 'Failed to add contact');
        }
        return;
      }

      onSuccess();
    } catch (error) {
      console.error('Error adding contact:', error);
      setError('An error occurred while adding the contact');
    } finally {
      setLoading(false);
    }
  };

  const handlePickFromDevice = async () => {
    if (!devicePickerSupported) {
      return;
    }
    setError('');
    setPickingFromDevice(true);
    try {
      const picked = await pickOneContactFromDevice();
      if (!picked) {
        return;
      }
      setContactSource('device_contacts');
      setFormData((prev) => ({
        ...prev,
        name: picked.name || prev.name,
        email: picked.email || prev.email,
        phone: picked.phone || prev.phone,
      }));
      if (!picked.phone) {
        setError(
          'This contact has no phone number we could read. Enter or correct the number below, then add.'
        );
      }
    } catch (e: unknown) {
      const n = e && typeof e === 'object' && 'name' in e ? String((e as { name: string }).name) : '';
      if (n === 'AbortError' || n === 'NotAllowedError') {
        return;
      }
      console.error('Contact picker error:', e);
      setError('Could not open your contacts. Enter the details below instead.');
    } finally {
      setPickingFromDevice(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold text-text-primary">Add Contact</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="rounded-lg border border-border bg-gray-50 p-4 space-y-2">
            <p className="text-sm font-medium text-text-primary">From your device</p>
            <p className="text-xs text-gray-600">
              Pick someone from your phone&apos;s address book (name and number fill in below).
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={loading || pickingFromDevice || !devicePickerSupported}
              onClick={handlePickFromDevice}
              isLoading={pickingFromDevice}
              className="w-full"
            >
              {!pickingFromDevice && <BookUser className="h-4 w-4" aria-hidden />}
              {pickingFromDevice ? 'Opening contacts…' : 'Choose from contacts'}
            </Button>
            {!devicePickerSupported && (
              <p className="text-xs text-gray-500">
                Only available in supported mobile browsers (e.g. Chrome on Android, over HTTPS). Use the
                fields below on other devices.
              </p>
            )}
          </div>

          <div className="relative flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-gray-500 shrink-0">Or enter manually</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

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
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="e.g., 919876543210"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <p className="mt-1 text-xs text-gray-500">
              Enter with country code (e.g., 91 for India)
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Contact name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="contact@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tags
            </label>
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
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Additional notes about this contact"
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Actions */}
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
                'Add Contact'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
