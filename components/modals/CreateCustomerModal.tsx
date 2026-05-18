'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { X } from 'lucide-react';
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { Customer } from '@/types/database';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { useToastContext } from '@/contexts/ToastContext';

interface CreateCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (customer: Customer) => void;
  initialData?: Partial<{
    name: string;
    company_name: string;
    phone: string;
    email: string;
    gstin: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
  }>;
}

export function CreateCustomerModal({
  isOpen,
  onClose,
  onSuccess,
  initialData = {},
}: CreateCustomerModalProps) {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [gstinLoading, setGstinLoading] = useState(false);
  const [gstinVerified, setGstinVerified] = useState(false);
  const [gstinError, setGstinError] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);
  const [sameAsBilling, setSameAsBilling] = useState(false);
  const hasCheckedLimitsRef = useRef(false);
  const prevIsOpenRef = useRef(false);

  const [formData, setFormData] = useState({
    name: initialData.name || '',
    company_name: initialData.company_name || '',
    phone: initialData.phone || '',
    email: initialData.email || '',
    gstin: initialData.gstin || '',
    address: initialData.address || '',
    billing_address: initialData.address || '',
    shipping_address: initialData.address || '',
    city: initialData.city || '',
    state: initialData.state || '',
    pincode: initialData.pincode || '',
    country: 'India',
    opening_balance: '',
    opening_balance_type: 'debit' as 'debit' | 'credit',
    credit_limit: '',
    credit_days: '',
  });

  // Reset form and check limits ONLY when modal opens (not on every render)
  useEffect(() => {
    // Only run when modal transitions from closed to open
    if (isOpen && !prevIsOpenRef.current) {
      setFormData({
        name: initialData.name || '',
        company_name: initialData.company_name || '',
        phone: initialData.phone || '',
        email: initialData.email || '',
        gstin: initialData.gstin || '',
        address: initialData.address || '',
        billing_address: initialData.address || '',
        shipping_address: initialData.address || '',
        city: initialData.city || '',
        state: initialData.state || '',
        pincode: initialData.pincode || '',
        country: 'India',
        opening_balance: '',
        opening_balance_type: 'debit',
        credit_limit: '',
        credit_days: '',
      });
      setGstinVerified(false);
      setGstinError(false);
      setSameAsBilling(false);
      hasCheckedLimitsRef.current = false;
      
      // Check subscription limits ONCE when modal opens
      if (business?.id && !hasCheckedLimitsRef.current) {
        hasCheckedLimitsRef.current = true;
        fetch(`/api/subscriptions/check-limit?business_id=${business.id}&limit_type=customers`)
          .then(res => res.json())
          .then(data => {
            setLimitInfo({ current: data.current, limit: data.limit });
            if (!data.allowed) {
              setShowUpgradePrompt(true);
            }
          })
          .catch(err => console.error('Failed to check limits:', err));
      }
    }
    
    // Reset flag when modal closes
    if (!isOpen && prevIsOpenRef.current) {
      hasCheckedLimitsRef.current = false;
    }
    
    prevIsOpenRef.current = isOpen;
  }, [isOpen, business?.id]); // Removed initialData from deps to prevent re-runs

  // Helper function to build multiline shipping address from billing fields
  const buildShippingAddress = (billingAddr: string, city: string, state: string, pincode: string): string => {
    const lines: string[] = [];
    if (billingAddr) lines.push(billingAddr);
    const locationParts: string[] = [];
    if (city) locationParts.push(city);
    if (state) locationParts.push(state);
    if (pincode) locationParts.push(pincode);
    if (locationParts.length > 0) {
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = { ...prev, [name]: value };
      
      if (name === 'gstin') {
        setGstinVerified(false);
        setGstinError(false);
      }
      
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

  const fetchGSTINDetails = async () => {
    if (!formData.gstin || formData.gstin.length !== 15) {
      setGstinError(true);
      setGstinVerified(false);
      return;
    }

    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstinRegex.test(formData.gstin)) {
      setGstinError(true);
      setGstinVerified(false);
      return;
    }

    setGstinLoading(true);
    setGstinVerified(false);
    setGstinError(false);
    
    try {
      const response = await fetch(`/api/gstin/lookup?gstin=${formData.gstin}`);
      const data = await response.json();

      if (response.ok) {
        const apiConfigured = data.api_configured !== false;
        const hasDetails = !!data.legal_name;
        
        if (apiConfigured && hasDetails) {
          setGstinVerified(true);
          setGstinError(false);
          setFormData(prev => ({
            ...prev,
            name: data.legal_name || data.trade_name || prev.name,
            billing_address: data.address || prev.billing_address,
            city: data.city || prev.city,
            state: data.state || prev.state,
            pincode: data.pincode || prev.pincode,
          }));
        } else {
          setGstinVerified(false);
          setGstinError(false);
          if (data.state_code) {
            const stateCode = data.state_code;
            const stateMap: Record<string, string> = {
              '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', 
              '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', 
              '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
              '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
              '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
              '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
              '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', 
              '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '32': 'Kerala',
              '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
              '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
            };
            setFormData(prev => ({
              ...prev,
              state: stateMap[stateCode] || prev.state
            }));
          }
        }
      } else {
        setGstinVerified(false);
        setGstinError(false);
      }
    } catch (error) {
      console.error('GSTIN verification error:', error);
      setGstinVerified(false);
      setGstinError(false);
    } finally {
      setGstinLoading(false);
    }
  };

  const toggleSameAsBilling = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isChecked = e.target.checked;
    setSameAsBilling(isChecked);
    if (isChecked) {
      setFormData(prev => ({
        ...prev,
        shipping_address: buildShippingAddress(prev.billing_address, prev.city, prev.state, prev.pincode)
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    
    if (limitInfo && limitInfo.limit !== -1 && limitInfo.current >= limitInfo.limit) {
      setShowUpgradePrompt(true);
      return;
    }
    
    setLoading(true);

    try {
      const stateCode = getStateCode(formData.state);
      
      const res = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          state_code: stateCode,
          business_id: business.id,
          created_by: user?.id,
          opening_balance: Number(formData.opening_balance) || 0,
          credit_limit: Number(formData.credit_limit) || 0,
          credit_days:
            formData.credit_days === '' || formData.credit_days === undefined
              ? undefined
              : Math.max(0, parseInt(String(formData.credit_days), 10) || 0),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const customer = data.customer;
        
        if (customer) {
          // Call onSuccess with the created customer
          onSuccess(customer);
          onClose();
        }
      } else {
        const data = await res.json();
        if (res.status === 403 && data.code === 'SUBSCRIPTION_LIMIT_EXCEEDED' && data.current !== undefined && data.limit !== undefined) {
          setLimitInfo({ current: data.current, limit: data.limit });
          setShowUpgradePrompt(true);
        } else {
          toast.error(data.error || 'Failed to create customer');
        }
      }
    } catch (error) {
      console.error(error);
      toast.error('Error creating customer');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 z-[9999] flex items-center justify-center p-4" 
        onClick={onClose}
      >
        <div 
          className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto relative" 
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">Add New Customer</h2>
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-full">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          
          <form onSubmit={handleSubmit} className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <Input label="Customer Name" name="name" value={formData.name} onChange={handleChange} required placeholder="e.g. Rahul Kumar" />
              </div>
              
              <div className="md:col-span-2">
                <Input label="Company Name (Optional)" name="company_name" value={formData.company_name} onChange={handleChange} placeholder="e.g. Rahul Traders" />
              </div>
              
              <IntlPhoneInput
                label="Phone Number"
                value={formData.phone}
                onChange={(full) => setFormData((prev) => ({ ...prev, phone: full }))}
                nationalPlaceholder="Mobile number"
              />
              <Input label="Email (Optional)" name="email" type="email" value={formData.email} onChange={handleChange} placeholder="rahul@example.com" />
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-text-secondary mb-1.5">GSTIN (Optional)</label>
                <div className="flex gap-2 relative">
                  <div className="flex-1 relative">
                    <input
                      name="gstin"
                      type="text"
                      value={formData.gstin}
                      onChange={handleChange}
                      placeholder="29ABCDE1234F1Z5"
                      maxLength={15}
                      className={`input w-full pr-10 transition-all ${
                        gstinVerified ? 'border-green-500 focus:ring-green-500 bg-green-50' : 
                        gstinError ? 'border-red-500 focus:ring-red-500 bg-red-50' : ''
                      }`}
                    />
                    {gstinVerified && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                    {gstinError && !gstinLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                        <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={fetchGSTINDetails}
                    disabled={!formData.gstin || formData.gstin.length !== 15 || gstinLoading}
                    className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center gap-2 whitespace-nowrap"
                  >
                    {gstinLoading ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Verifying...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Fetch Details
                      </>
                    )}
                  </button>
                </div>
                {gstinVerified && (
                  <p className="mt-1.5 text-xs text-green-600 font-medium flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Verified • Details auto-filled
                  </p>
                )}
                {gstinError && !gstinLoading && (
                  <p className="mt-1.5 text-xs text-red-600 font-medium flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                    Invalid GSTIN format
                  </p>
                )}
              </div>
              
              <div className="md:col-span-2 pt-4 border-t border-border">
                <h3 className="text-sm font-semibold text-text-secondary mb-4">Address Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-text-secondary mb-1">Billing Address (Primary)</label>
                    <textarea 
                      name="billing_address" 
                      value={formData.billing_address} 
                      onChange={handleChange} 
                      placeholder="Shop No, Street, Area" 
                      className="w-full min-h-[80px] px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm resize-y"
                    />
                  </div>
                  
                  <Input label="Billing City" name="city" value={formData.city} onChange={handleChange} placeholder="City" />
                  
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1.5">Billing State</label>
                    <select name="state" value={formData.state} onChange={handleChange} className="input w-full">
                      <option value="">Select State</option>
                      {INDIAN_STATES.map((state) => (
                        <option key={state} value={state}>{state}</option>
                      ))}
                    </select>
                  </div>
                  
                  <Input label="Billing Pincode" name="pincode" value={formData.pincode} onChange={handleChange} placeholder="560001" inputMode="numeric" />
                  
                  <div className="md:col-span-2 border-t border-border pt-4 mt-2">
                    <label className="block text-sm font-medium text-text-secondary mb-2">Shipping Address</label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm text-text-secondary hover:text-primary-600 mb-2">
                      <input 
                        type="checkbox" 
                        checked={sameAsBilling} 
                        onChange={toggleSameAsBilling}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      Same as Billing Address
                    </label>
                    <textarea 
                      name="shipping_address" 
                      value={formData.shipping_address} 
                      onChange={handleChange} 
                      placeholder="Delivery Location (Full address)" 
                      readOnly={sameAsBilling}
                      className={`w-full min-h-[80px] px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm resize-y ${sameAsBilling ? 'bg-gray-50 opacity-75 cursor-not-allowed' : ''}`}
                    />
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 pt-4 border-t border-border">
                <h3 className="text-sm font-semibold text-text-secondary mb-4">Financial Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">Opening Balance</label>
                    <div className="flex gap-2">
                      <Input 
                        name="opening_balance" 
                        type="number" 
                        inputMode="decimal"
                        value={formData.opening_balance} 
                        onChange={handleChange} 
                        placeholder="0.00" 
                        className="flex-1"
                      />
                      <select 
                        name="opening_balance_type"
                        className="input w-32"
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
                    inputMode="decimal"
                    value={formData.credit_limit} 
                    onChange={handleChange} 
                    placeholder="0.00" 
                  />
                  <Input 
                    label="Credit days (Net)"
                    name="credit_days" 
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={formData.credit_days} 
                    onChange={handleChange} 
                    placeholder="e.g. 30 — leave blank for no auto due date"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-4 pt-6 mt-6 border-t border-border">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" isLoading={loading}>Save Customer</Button>
            </div>
          </form>
        </div>
      </div>

      {showUpgradePrompt && limitInfo && (
        <UpgradeModal
          limitType="customers"
          currentCount={limitInfo.current}
          limit={limitInfo.limit}
          onClose={() => setShowUpgradePrompt(false)}
          onUpgradeSuccess={() => {
            setShowUpgradePrompt(false);
            // Don't reload, just close the upgrade modal
          }}
        />
      )}
    </>
  );
}
