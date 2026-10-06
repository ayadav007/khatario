'use client';

export const dynamic = 'force-dynamic';

import { isValidGstin } from '@/lib/tax/gstin';
import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { AnnotatedFormSection } from '@/components/ui/AnnotatedFormSection';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';

import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import { useEntityMutation } from '@/hooks/useEntityMutation';
import { useToastContext } from '@/contexts/ToastContext';

function NewCustomerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { canAdd, loading: permissionsLoading } = usePermissions();

  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'customers',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });

  const { create, loading: mutationLoading } = useEntityMutation({
    entity: 'customers',
    businessId: business?.id ?? null,
  });

  const [gstinLoading, setGstinLoading] = useState(false);
  const [gstinVerified, setGstinVerified] = useState(false);
  const [gstinError, setGstinError] = useState(false);

  // Subscription limit checking
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [limitInfo, setLimitInfo] = useState<{ current: number; limit: number } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    company_name: '',
    phone: '',
    email: '',
    gstin: '',
    address: '', // Kept for backward compatibility
    billing_address: '',
    shipping_address: '',
    city: '', // Billing city
    state: '', // Billing state
    pincode: '', // Billing pincode
    country: 'India', // Country of destination for export invoices
    opening_balance: '',
    opening_balance_type: 'debit',
    credit_limit: '',
    credit_days: '',
  });

  const [sameAsBilling, setSameAsBilling] = useState(false);

  // Pre-fill from query parameters
  const returnUrl = searchParams?.get('return_url') || '';

  // Check subscription limits on mount
  useEffect(() => {
    const checkLimits = async () => {
      if (!business?.id) return;

      try {
        const limitRes = await fetch(`/api/subscriptions/check-limit?business_id=${business.id}&limit_type=customers`);
        if (limitRes.ok) {
          const limitData = await limitRes.json();
          setLimitInfo({ current: limitData.current, limit: limitData.limit });

          if (!limitData.allowed) {
            setShowUpgradePrompt(true);
          }
        }
      } catch (error) {
        console.error('Failed to check limits:', error);
      }
    };

    checkLimits();
  }, [business?.id]);

  useEffect(() => {
    // Pre-fill business details from query parameters
    const name = searchParams?.get('name');
    const companyName = searchParams?.get('company_name');
    const phone = searchParams?.get('phone');
    const email = searchParams?.get('email');
    const gstin = searchParams?.get('gstin');
    const address = searchParams?.get('address');
    const city = searchParams?.get('city');
    const state = searchParams?.get('state');
    const pincode = searchParams?.get('pincode');

    if (name || companyName || phone || email || gstin || address || city || state || pincode) {
      setFormData(prev => ({
        ...prev,
        ...(name && { name: decodeURIComponent(name) }),
        ...(companyName && { company_name: decodeURIComponent(companyName) }),
        ...(phone && { phone: decodeURIComponent(phone) }),
        ...(email && { email: decodeURIComponent(email) }),
        ...(gstin && { gstin: decodeURIComponent(gstin) }),
        ...(address && { billing_address: decodeURIComponent(address), address: decodeURIComponent(address) }),
        ...(city && { city: decodeURIComponent(city) }),
        ...(state && { state: decodeURIComponent(state) }),
        ...(pincode && { pincode: decodeURIComponent(pincode) })
      }));
    }
  }, [searchParams]);

  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      <AccessDenied
        module="customers"
        action="create"
        details={reason}
        code="CUSTOMER_CREATE_DENIED"
      />
    );
  }

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => {
      const newData = { ...prev, [name]: value };

      // Reset GSTIN verification when GSTIN changes
      if (name === 'gstin') {
        setGstinVerified(false);
        setGstinError(false);
      }

      // Auto-calculate state_code when state changes
      if (name === 'state') {
        const stateCode = getStateCode(value);
        // Store state_code in a hidden field or include in submission
        // We'll include it in the submission
        void stateCode;
      }

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

  const fetchGSTINDetails = async () => {
    if (!formData.gstin || formData.gstin.length !== 15) {
      setGstinError(true);
      setGstinVerified(false);
      return;
    }

    if (!isValidGstin(formData.gstin)) {
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
        // Check if API was configured and data was fetched
        const apiConfigured = data.api_configured !== false;
        const hasDetails = !!data.legal_name;

        if (apiConfigured && hasDetails) {
          // Success - Valid GSTIN with details from API
          setGstinVerified(true);
          setGstinError(false);

          // Auto-populate form fields with fetched data
          setFormData(prev => ({
            ...prev,
            name: data.legal_name || data.trade_name || prev.name,
            billing_address: data.address || prev.billing_address,
            city: data.city || prev.city,
            state: data.state || prev.state,
            pincode: data.pincode || prev.pincode,
          }));
        } else {
          // API couldn't fetch details, but GSTIN format is valid
          // Mark as "format valid" but not "API verified"
          setGstinVerified(false);
          setGstinError(false); // Don't show error for valid format

          // Extract state from GSTIN
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
        // API error
        setGstinVerified(false);
        setGstinError(false); // Don't mark as error if format is valid
      }
    } catch (error) {
      console.error('GSTIN verification error:', error);
      setGstinVerified(false);
      setGstinError(false); // Don't mark as error if format is valid
    } finally {
      setGstinLoading(false);
    }
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
    if (!business || !user?.id) return;

    if (limitInfo && limitInfo.limit !== -1 && limitInfo.current >= limitInfo.limit) {
      setShowUpgradePrompt(true);
      return;
    }

    const stateCode = getStateCode(formData.state);
    const customerId = crypto.randomUUID();
    const payload = {
      name: formData.name,
      company_name: formData.company_name || null,
      phone: formData.phone || null,
      email: formData.email || null,
      address: formData.address || null,
      billing_address: formData.billing_address || formData.address || null,
      shipping_address: formData.shipping_address || formData.address || null,
      city: formData.city || null,
      state: formData.state || null,
      state_code: stateCode,
      pincode: formData.pincode || null,
      country: formData.country || 'India',
      gstin: formData.gstin || null,
      opening_balance: Number(formData.opening_balance) || 0,
      opening_balance_type: formData.opening_balance_type || 'debit',
      credit_limit: Number(formData.credit_limit) || 0,
      credit_days:
        formData.credit_days === '' || formData.credit_days === undefined
          ? undefined
          : Math.max(0, parseInt(String(formData.credit_days), 10) || 0),
      business_id: business.id,
      created_by: user.id,
    };

    try {
      await create({ ...payload, id: customerId });
      if (returnUrl) {
        const decodedReturnUrl = decodeURIComponent(returnUrl);
        const returnUrlObj = new URL(decodedReturnUrl, window.location.origin);
        returnUrlObj.searchParams.set('customer_id', customerId);
        router.push(returnUrlObj.pathname + returnUrlObj.search);
      } else {
        router.push('/customers');
        router.refresh();
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to save customer. Please try again.');
    }
  };

  return (
    <>
      <div className="w-full min-w-0 max-w-5xl space-y-6">
        <MobileDuplicatePageChrome
          title="Add new customer"
          description="Contact, address and credit details used on invoices and statements."
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
                placeholder="e.g. Rahul Kumar"
              />
              <Input
                label="Company name"
                name="company_name"
                value={formData.company_name}
                onChange={handleChange}
                placeholder="e.g. Rahul Traders"
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
                  placeholder="rahul@example.com"
                />
              </div>
            </AnnotatedFormSection>

            <AnnotatedFormSection
              title="GSTIN"
              description="Optional. Look up registered name and address when the verification API is available."
            >
              <div>
                <label className="type-label mb-1.5 block">GSTIN</label>
                <div className="relative flex flex-wrap gap-2 sm:flex-nowrap">
                  <div className="relative flex-1">
                    <input
                      name="gstin"
                      type="text"
                      value={formData.gstin}
                      onChange={handleChange}
                      placeholder="29ABCDE1234F1Z5"
                      maxLength={15}
                      className={`input w-full pr-10 transition-all ${
                        gstinVerified
                          ? 'border-green-500 bg-green-50 focus:ring-green-500'
                          : gstinError
                            ? 'border-red-500 bg-red-50 focus:ring-red-500'
                            : ''
                      }`}
                    />
                    {gstinVerified && (
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                        <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                    {gstinError && !gstinLoading && (
                      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
                        <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={fetchGSTINDetails}
                    disabled={!formData.gstin || formData.gstin.length !== 15 || gstinLoading}
                    className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {gstinLoading ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Verifying...
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        Fetch details
                      </>
                    )}
                  </button>
                </div>
                {gstinVerified && (
                  <p className="mt-1.5 text-xs font-medium text-green-600">
                    Verified • Details auto-filled
                  </p>
                )}
                {gstinError && !gstinLoading && (
                  <p className="mt-1.5 text-xs font-medium text-red-600">
                    Invalid GSTIN format
                  </p>
                )}
                {!gstinVerified && !gstinError && !gstinLoading && formData.gstin.length === 15 && (
                  <p className="mt-1.5 text-xs font-medium text-amber-600">
                    GSTIN format valid • API verification unavailable • You can still proceed
                  </p>
                )}
              </div>
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
                  inputMode="numeric"
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
              description="Opening balance and credit limit for receivables and alerts."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="type-label mb-1.5 block">Opening balance</label>
                  <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                    <Input
                      name="opening_balance"
                      type="number"
                      inputMode="decimal"
                      value={formData.opening_balance}
                      onChange={handleChange}
                      placeholder="0.00"
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
                  placeholder="e.g. 30 — optional"
                />
              </div>
            </AnnotatedFormSection>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4 dark:border-border-dark">
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" isLoading={mutationLoading}>
              Save customer
            </Button>
          </div>
        </form>
      </div>

      {showUpgradePrompt && limitInfo && (
        <UpgradeModal
          limitType="customers"
          currentCount={limitInfo.current}
          limit={limitInfo.limit}
          onClose={() => {
            setShowUpgradePrompt(false);
          }}
          onUpgradeSuccess={() => {
            setShowUpgradePrompt(false);
            window.location.reload();
          }}
        />
      )}
    </>
  );
}

export default function NewCustomerPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-primary-600"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <NewCustomerContent />
    </Suspense>
  );
}
