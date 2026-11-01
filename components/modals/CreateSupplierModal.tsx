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
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { checkGstin } from '@/lib/tax/gstin';

interface CreateSupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (supplier: Supplier) => void;
  initialData?: Partial<{
    name: string;
    phone: string;
    email: string;
    gstin: string;
    state: string;
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
    state: '',
  });
  const [gstinError, setGstinError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setFormData({
        name: initialData.name || '',
        phone: initialData.phone || '',
        email: initialData.email || '',
        gstin: initialData.gstin || '',
        state: initialData.state || '',
      });
      setGstinError(null);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, initialData.name, initialData.phone, initialData.email, initialData.gstin, initialData.state]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'gstin') {
        const gstin = value.replace(/\s+/g, '').toUpperCase();
        next.gstin = gstin;
        if (!gstin) {
          setGstinError(null);
        } else if (gstin.length === 15) {
          const check = checkGstin(gstin);
          if (check.valid) {
            setGstinError(null);
            if (check.stateName && (INDIAN_STATES as readonly string[]).includes(check.stateName)) {
              next.state = check.stateName;
            }
          } else {
            setGstinError(check.error);
          }
        } else {
          setGstinError(null);
        }
      }
      return next;
    });
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
    const gstin = formData.gstin.trim().toUpperCase();
    let state = formData.state.trim();
    let stateCode = state ? getStateCode(state) : '';
    if (gstin) {
      const check = checkGstin(gstin);
      if (!check.valid) {
        setGstinError(check.error);
        toast.error(check.error);
        return;
      }
      if (check.stateName && !state) state = check.stateName;
      stateCode = check.stateCode;
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
          gstin: gstin || null,
          state: state || null,
          state_code: stateCode || null,
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
            placeholder="15 characters from the GST certificate"
            maxLength={15}
            error={gstinError || undefined}
          />
          <div>
            <label htmlFor="supplier-state" className="mb-1.5 block text-sm font-medium text-text-secondary">
              State
            </label>
            <select
              id="supplier-state"
              name="state"
              value={formData.state}
              onChange={handleChange}
              className="input w-full"
            >
              <option value="">Select state</option>
              {formData.state && !(INDIAN_STATES as readonly string[]).includes(formData.state) ? (
                <option value={formData.state}>{formData.state}</option>
              ) : null}
              {INDIAN_STATES.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-text-muted">Used for GST on purchases and expenses. A GSTIN fills this from its first two digits.</p>
          </div>

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
