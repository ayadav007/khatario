'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { AnnotatedFormSection } from '@/components/ui/AnnotatedFormSection';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useEntityRecord } from '@/hooks/useEntityRecord';
import { useEntityMutation } from '@/hooks/useEntityMutation';
import { useToastContext } from '@/contexts/ToastContext';
import { INDIAN_STATES } from '@/lib/gst-utils';

export default function EditCustomerPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [sameAsBilling, setSameAsBilling] = useState(false);

  const { data: customer, loading, refetch } = useEntityRecord({
    recordId: params.id,
    apiUrl: (id) => `/api/customers/${id}`,
    responseKey: 'customer',
  });

  const { update, loading: saving } = useEntityMutation({
    entity: 'customers',
    businessId: business?.id ?? null,
  });

  // Check authorization before rendering form
  const { allowed: canUpdate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'customers',
    action: 'update',
    resourceId: params.id,
    skipCheck: !user?.id || !business?.id
  });
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    gstin: '',
    address: '',
    billing_address: '',
    shipping_address: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India',
    opening_balance: '',
    opening_balance_type: 'debit',
    credit_limit: '',
    credit_days: ''
  });

  // Helper function to build multiline shipping address from billing fields
  const buildShippingAddress = (billingAddr: string, city: string, state: string, pincode: string): string => {
    const lines: string[] = [];

    // Line 1: billing_address
    if (billingAddr) {
      lines.push(billingAddr);
    }

    // Line 2: "city, state - pincode"
    const locationParts: string[] = [];
    if (city) locationParts.push(city);
    if (state) locationParts.push(state);
    if (pincode) locationParts.push(pincode);

    if (locationParts.length > 0) {
      // Format: "city, state - pincode" or "city, state" or "pincode"
      if (locationParts.length === 3) {
        lines.push(`${locationParts[0]}, ${locationParts[1]} - ${locationParts[2]}`);
      } else if (locationParts.length === 2) {
        lines.push(locationParts.join(', '));
      } else {
        lines.push(locationParts[0]);
      }
    }

    return lines.join('\n');
  };

  useEffect(() => {
    if (customer) {
      const c = customer as Record<string, unknown>;
      const loadedData = {
        name: String(c.name ?? ''),
        phone: String(c.phone ?? ''),
        email: String(c.email ?? ''),
        gstin: String(c.gstin ?? ''),
        address: String(c.address ?? ''),
        billing_address: String(c.billing_address ?? c.address ?? ''),
        shipping_address: String(c.shipping_address ?? c.address ?? ''),
        city: String(c.city ?? ''),
        state: String(c.state ?? ''),
        pincode: String(c.pincode ?? ''),
        country: String(c.country ?? 'India'),
        opening_balance: c.opening_balance != null ? String(c.opening_balance) : '0',
        opening_balance_type: String(c.opening_balance_type ?? 'debit'),
        credit_limit: c.credit_limit != null ? String(c.credit_limit) : '0',
        credit_days:
          c.credit_days != null && c.credit_days !== ''
            ? String(c.credit_days)
            : ''
      };
      setFormData(loadedData);
      const expectedShipping = buildShippingAddress(
        loadedData.billing_address,
        loadedData.city,
        loadedData.state,
        loadedData.pincode
      );
      if (loadedData.shipping_address.trim() === expectedShipping.trim()) {
        setSameAsBilling(true);
      }
    } else if (!loading && params.id) {
      refetch();
    }
  }, [customer, loading, params.id, refetch]);

  useEffect(() => {
    if (!loading && !customer) {
      router.push('/customers');
    }
  }, [loading, customer, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = { ...prev, [name]: value };

      // If "Same as Billing" is checked and a billing field changed, rebuild shipping address
      if (sameAsBilling && (name === 'billing_address' || name === 'city' || name === 'state' || name === 'pincode')) {
        const updatedBillingAddr = name === 'billing_address' ? value : newData.billing_address;
        const updatedCity = name === 'city' ? value : newData.city;
        const updatedState = name === 'state' ? value : newData.state;
        const updatedPincode = name === 'pincode' ? value : newData.pincode;

        newData.shipping_address = buildShippingAddress(updatedBillingAddr, updatedCity, updatedState, updatedPincode);
      }

      return newData;
    });
  };

  const toggleSameAsBilling = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setSameAsBilling(isChecked);

    if (isChecked) {
      // Build multiline string from billing fields and set to shipping_address
      setFormData(prev => ({
        ...prev,
        shipping_address: buildShippingAddress(prev.billing_address, prev.city, prev.state, prev.pincode)
      }));
    }
    // When unchecked, shipping_address remains as-is (do not clear)
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !business?.id) return;

    try {
      await update(params.id, {
        ...formData,
        opening_balance: Number(formData.opening_balance) || 0,
        credit_limit: Number(formData.credit_limit) || 0,
        credit_days:
          formData.credit_days === '' || formData.credit_days === undefined
            ? null
            : Math.max(0, parseInt(String(formData.credit_days), 10) || 0),
        user_id: user.id,
        business_id: business.id,
      });
      router.push(`/customers/${params.id}`);
      router.refresh();
    } catch (error) {
      console.error(error);
      const msg =
        error instanceof Error && error.message
          ? error.message
          : 'Failed to update customer';
      toast.error(msg);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!canUpdate) {
    return (
      <AccessDenied
        module="customers"
        action="update"
        details={reason}
        code="CUSTOMER_UPDATE_DENIED"
      />
    );
  }

  return (
    <div className="w-full min-w-0 max-w-5xl space-y-6">
      <MobileDuplicatePageChrome
        title="Edit customer"
        description="Update contact, address and credit details used on invoices and statements."
      />

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          <AnnotatedFormSection
            title="Basic details"
            description="Primary contact used on invoices and statements."
          >
            <Input
              label="Customer name *"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <IntlPhoneInput
                label="Phone number"
                value={formData.phone}
                onChange={(full) => setFormData((prev) => ({ ...prev, phone: full }))}
                nationalPlaceholder="Mobile number"
              />
              <Input
                label="Email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
              />
            </div>
            <Input
              label="GSTIN"
              name="gstin"
              value={formData.gstin}
              onChange={handleChange}
            />
          </AnnotatedFormSection>

          <AnnotatedFormSection
            title="Billing address"
            description="Primary address for invoices, e-way bills, and GST records."
          >
            <div>
              <label className="type-label mb-1.5 block">Billing address</label>
              <textarea
                name="billing_address"
                value={formData.billing_address}
                onChange={handleChange}
                placeholder="Shop No, Street, Area"
                className="input min-h-[80px] w-full resize-y"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input label="City" name="city" value={formData.city} onChange={handleChange} placeholder="City" />
              <div>
                <label className="type-label mb-1.5 block">State</label>
                <select
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  className="input w-full"
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Pincode"
                name="pincode"
                value={formData.pincode}
                onChange={handleChange}
                placeholder="560001"
              />
            </div>
            <div className="max-w-md">
              <label className="type-label mb-1.5 block">Country</label>
              <select
                name="country"
                value={formData.country}
                onChange={handleChange}
                className="input w-full"
              >
                <option value="India">India</option>
                <option value="United States">United States</option>
                <option value="United Kingdom">United Kingdom</option>
                <option value="United Arab Emirates">United Arab Emirates</option>
                <option value="Singapore">Singapore</option>
                <option value="Germany">Germany</option>
                <option value="France">France</option>
                <option value="Canada">Canada</option>
                <option value="Australia">Australia</option>
                <option value="Japan">Japan</option>
                <option value="China">China</option>
                <option value="Other">Other</option>
              </select>
              <p className="mt-1 text-xs text-text-muted">Required for export invoices</p>
            </div>
          </AnnotatedFormSection>

          <AnnotatedFormSection
            title="Shipping address"
            description="Delivery location for dispatch. Can match billing or stay separate."
          >
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary hover:text-primary-600">
              <input
                type="checkbox"
                checked={sameAsBilling}
                onChange={toggleSameAsBilling}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Same as billing address
            </label>
            <textarea
              name="shipping_address"
              value={formData.shipping_address}
              onChange={handleChange}
              placeholder="Delivery location"
              readOnly={sameAsBilling}
              className={`input min-h-[80px] w-full resize-y ${sameAsBilling ? 'cursor-not-allowed bg-gray-50 opacity-75 dark:bg-slate-800/50' : ''}`}
            />
          </AnnotatedFormSection>

          <AnnotatedFormSection
            title="Financial details"
            description="Opening balance type and credit limit for receivables."
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="type-label mb-1.5 block">Opening balance</label>
                <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                  <Input
                    name="opening_balance"
                    type="number"
                    value={formData.opening_balance}
                    onChange={handleChange}
                    className="min-w-0 flex-1"
                  />
                  <select
                    name="opening_balance_type"
                    className="input w-full shrink-0 sm:w-32"
                    value={formData.opening_balance_type}
                    onChange={handleChange}
                  >
                    <option value="debit">To Receive</option>
                    <option value="credit">To Pay</option>
                  </select>
                </div>
              </div>
              <Input
                label="Credit limit"
                name="credit_limit"
                type="number"
                value={formData.credit_limit}
                onChange={handleChange}
                placeholder="0"
              />
              <Input
                label="Credit days (Net)"
                name="credit_days"
                type="number"
                min={0}
                value={formData.credit_days}
                onChange={handleChange}
                placeholder="Optional — e.g. 30"
              />
            </div>
          </AnnotatedFormSection>
        </div>

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving}>
            Update customer
          </Button>
        </div>
      </form>
    </div>
  );
}
