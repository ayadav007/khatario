'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
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

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  return (
    <FormPageContainer>
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Edit Customer</h1>
        </div>

        <FormCard>
          <form onSubmit={handleSubmit}>
            <div className="form-page-shell">
              <FormSection
                title="Basic details"
                description="Primary contact used on invoices and statements."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6">
              <div className="sm:col-span-2 lg:col-span-3">
                <Input label="Customer Name" name="name" value={formData.name} onChange={handleChange} required />
              </div>
              
              <IntlPhoneInput
                label="Phone Number"
                value={formData.phone}
                onChange={(full) => setFormData((prev) => ({ ...prev, phone: full }))}
                nationalPlaceholder="Mobile number"
              />
              <Input label="Email (Optional)" name="email" type="email" value={formData.email} onChange={handleChange} />
              
              <div className="sm:col-span-2 lg:col-span-3">
                <Input label="GSTIN (Optional)" name="gstin" value={formData.gstin} onChange={handleChange} />
              </div>
                </div>
              </FormSection>

              <FormSection
                title="Billing address"
                description="Primary address for invoices, e-way bills, and GST records."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-sm font-medium text-text-secondary mb-1">Billing Address (Primary)</label>
                    <textarea 
                        name="billing_address" 
                        value={formData.billing_address} 
                        onChange={handleChange} 
                        placeholder="Shop No, Street, Area" 
                        className="w-full min-h-[80px] px-3 py-2 rounded-md border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm resize-y"
                    />
                  </div>
                  
                  <Input label="Billing City" name="city" value={formData.city} onChange={handleChange} placeholder="City" />
                  
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Billing State</label>
                    <select
                      name="state"
                      value={formData.state}
                      onChange={handleChange}
                      className="input w-full"
                    >
                      <option value="">Select State</option>
                      {INDIAN_STATES.map((state) => (
                        <option key={state} value={state}>
                          {state}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <Input label="Billing Pincode" name="pincode" value={formData.pincode} onChange={handleChange} placeholder="560001" />
                  
                  <div className="sm:col-span-2 lg:col-span-2">
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Country</label>
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
                    <p className="text-xs text-gray-500 mt-1">Required for export invoices</p>
                  </div>
                </div>
              </FormSection>

              <FormSection
                title="Shipping address"
                description="Delivery location for dispatch. Can match billing or stay separate."
              >
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-text-secondary hover:text-primary-600 mb-3">
                        <input 
                            type="checkbox" 
                            checked={sameAsBilling} 
                            onChange={toggleSameAsBilling}
                            className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                        />
                        Same as billing address
                    </label>
                    
                    <textarea 
                        name="shipping_address" 
                        value={formData.shipping_address} 
                        onChange={handleChange} 
                        placeholder="Delivery location (full address)" 
                        readOnly={sameAsBilling}
                        className={`w-full max-w-3xl min-h-[80px] px-3 py-2 rounded-md border border-border bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm resize-y ${sameAsBilling ? 'bg-gray-50 opacity-75 cursor-not-allowed' : ''}`}
                    />
              </FormSection>

              <FormSection
                title="Financial details"
                description="Opening balance type and credit limit for receivables."
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6">
                  <div className="sm:col-span-2 lg:col-span-2">
                    <label className="block text-sm font-medium text-text-secondary mb-1">Opening Balance</label>
                    <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                      <Input 
                        name="opening_balance" 
                        type="number" 
                        value={formData.opening_balance} 
                        onChange={handleChange} 
                        className="flex-1 min-w-0"
                      />
                      <select 
                        name="opening_balance_type"
                        className="input w-full sm:w-32 shrink-0"
                        value={formData.opening_balance_type}
                        onChange={handleChange}
                      >
                        <option value="debit">To Receive</option>
                        <option value="credit">To Pay</option>
                      </select>
                    </div>
                  </div>
                  
                  <Input 
                    label="Credit Limit" 
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
              </FormSection>
            </div>

            <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
              <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" isLoading={saving}>Update Customer</Button>
            </div>
          </form>
        </FormCard>
    </FormPageContainer>
  );
}
