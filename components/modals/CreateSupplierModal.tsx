'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { X } from 'lucide-react';
import { Supplier } from '@/types/database';
import { useToastContext } from '@/contexts/ToastContext';
import { getApiErrorMessage, safeJsonParse } from '@/lib/api-utils';

interface CreateSupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (supplier: Supplier) => void;
  initialData?: Partial<{
    name: string;
    phone: string;
    email: string;
    gstin: string;
  }>;
}

export function CreateSupplierModal({
  isOpen,
  onClose,
  onSuccess,
  initialData = {},
}: CreateSupplierModalProps) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const prevIsOpenRef = useRef(false);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    gstin: '',
  });

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setFormData({
        name: initialData.name || '',
        phone: initialData.phone || '',
        email: initialData.email || '',
        gstin: initialData.gstin || '',
      });
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialData.name, initialData.phone, initialData.email, initialData.gstin]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !user?.id) {
      toast.error('You must be signed in.');
      return;
    }
    const name = formData.name.trim();
    if (!name) {
      toast.warning('Supplier name is required.');
      return;
    }

    setLoading(true);
    try {
      const phoneDigits = formData.phone.replace(/\D/g, '');
      const phonePayload =
        phoneDigits.length >= 8 && phoneDigits.length <= 15 ? phoneDigits : null;

      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          business_id: business.id,
          name,
          phone: phonePayload,
          email: formData.email.trim() || null,
          gstin: formData.gstin.trim().toUpperCase() || null,
          opening_balance: 0,
          opening_balance_type: 'credit',
          created_by_user_id: user.id,
        }),
      });

      const data = (await safeJsonParse(res)) as Record<string, unknown>;
      if (!res.ok) {
        toast.error(getApiErrorMessage(data, 'Failed to create supplier'));
        return;
      }
      const supplier = data?.supplier as Supplier | undefined;
      if (supplier) {
        toast.success(
          data?.deduplicated ? 'Using existing supplier' : 'Supplier created'
        );
        onSuccess(supplier);
        onClose();
      } else {
        toast.error('Supplier was not returned from the server.');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error creating supplier');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-lg font-bold text-gray-900">Add new supplier</h2>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-full" aria-label="Close">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <Input
            label="Supplier name"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            placeholder="e.g. ABC Traders"
          />
          <IntlPhoneInput
            label="Phone (optional)"
            value={formData.phone}
            onChange={(full) => setFormData((prev) => ({ ...prev, phone: full }))}
            nationalPlaceholder="Mobile number"
          />
          <Input
            label="Email (optional)"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="contact@example.com"
          />
          <Input
            label="GSTIN (optional)"
            name="gstin"
            value={formData.gstin}
            onChange={handleChange}
            placeholder="15-character GSTIN"
            maxLength={15}
          />

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" isLoading={loading}>
              Save supplier
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
