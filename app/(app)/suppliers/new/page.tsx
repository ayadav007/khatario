'use client';

export const dynamic = 'force-dynamic';

import { useState, useMemo, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FormSection } from '@/components/ui/FormSection';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Link2, Building2, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { INDIAN_STATES, getStateCode } from '@/lib/gst-utils';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useEntityMutation } from '@/hooks/useEntityMutation';
import { useToastContext } from '@/contexts/ToastContext';

export default function NewSupplierPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { create, loading: saving } = useEntityMutation({
    entity: 'suppliers',
    businessId: business?.id ?? null,
  });
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'suppliers',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [gstinLoading, setGstinLoading] = useState(false);
  const [gstinVerified, setGstinVerified] = useState(false);
  const [gstinError, setGstinError] = useState(false);
  const [businessSearchQuery, setBusinessSearchQuery] = useState('');
  const [searchingBusinesses, setSearchingBusinesses] = useState(false);
  const [businessSearchResults, setBusinessSearchResults] = useState<any[]>([]);
  const [linkedBusiness, setLinkedBusiness] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    gstin: '',
    opening_balance: '0',
    opening_balance_type: 'credit',
    allow_low_stock_access: false,
  });
  const [duplicateWarnings, setDuplicateWarnings] = useState<any[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [dismissedMatchIds, setDismissedMatchIds] = useState<Set<string>>(new Set());
  const [showExtraMatches, setShowExtraMatches] = useState(false);

  const resultIdsKey = useMemo(
    () => businessSearchResults.map((r: any) => r.id).sort().join(','),
    [businessSearchResults]
  );

  useEffect(() => {
    setDismissedMatchIds(new Set());
    setShowExtraMatches(false);
  }, [resultIdsKey]);

  function handleChange(field: string, value: string | boolean) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    
    // Reset GSTIN verification when GSTIN changes
    if (field === 'gstin') {
      setGstinVerified(false);
      setGstinError(false);
    }

    // Auto-search businesses when name, phone, or GSTIN changes
    if ((field === 'name' || field === 'phone' || field === 'gstin') && !linkedBusiness && typeof value === 'string') {
      searchBusinesses(
        field === 'name' ? value : formData.name, 
        field === 'phone' ? value : formData.phone,
        field === 'gstin' ? value : formData.gstin
      );
    }
  }

  const searchBusinesses = async (name: string, phone: string, gstin?: string) => {
    if ((!name || name.length < 3) && (!phone || phone.length < 3) && (!gstin || gstin.length < 15)) {
      setBusinessSearchResults([]);
      return;
    }

    setSearchingBusinesses(true);
    try {
      const params = new URLSearchParams();
      if (name) params.append('name', name);
      if (phone) params.append('phone', phone);
      if (gstin && gstin.length === 15) params.append('gstin', gstin);
      params.append('exclude_business_id', business!.id);

      const res = await fetch(`/api/suppliers/search-business?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setBusinessSearchResults(data.results || []);
      }
    } catch (error) {
      console.error('Error searching businesses:', error);
    } finally {
      setSearchingBusinesses(false);
    }
  };

  const linkToBusiness = (selectedBusiness: any) => {
    setLinkedBusiness(selectedBusiness);
    setBusinessSearchResults([]);
    setFormData(prev => ({
      ...prev,
      name: selectedBusiness.name,
      phone: selectedBusiness.phone || prev.phone,
      email: selectedBusiness.email || prev.email,
      address: selectedBusiness.address || prev.address,
      city: selectedBusiness.city || prev.city,
      state: selectedBusiness.state || prev.state,
      pincode: selectedBusiness.pincode || prev.pincode,
      gstin: selectedBusiness.gstin || prev.gstin,
    }));
    if (selectedBusiness.gstin) {
      setGstinVerified(true);
    }
  };

  const unlinkBusiness = () => {
    setLinkedBusiness(null);
  };

  const sortedMatches = useMemo(() => {
    return [...businessSearchResults].sort(
      (a: any, b: any) => (b.match_confidence ?? 0) - (a.match_confidence ?? 0)
    );
  }, [businessSearchResults]);

  const visibleMatches = useMemo(
    () => sortedMatches.filter((r: any) => !dismissedMatchIds.has(r.id)),
    [sortedMatches, dismissedMatchIds]
  );

  const dismissMatch = (id: string) => {
    setDismissedMatchIds((prev) => new Set(prev).add(id));
  };

  function matchTier(score: number): 'strong' | 'possible' | 'weak' {
    if (score >= 90) return 'strong';
    if (score >= 70) return 'possible';
    return 'weak';
  }

  async function fetchGSTINDetails() {
    if (!formData.gstin || formData.gstin.length !== 15) {
      setGstinError(true);
      setGstinVerified(false);
      return;
    }

    // Validate GSTIN format
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
            address: data.address || prev.address,
            city: data.city || prev.city,
            state: data.state || prev.state,
            pincode: data.pincode || prev.pincode,
          }));
        } else {
          // API couldn't fetch details, but GSTIN format is valid
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
  }

  const checkDuplicates = async () => {
    if (!formData.name && !formData.phone && !formData.gstin) {
      return { hasDuplicates: false, duplicates: [] };
    }

    try {
      const params = new URLSearchParams();
      params.append('business_id', business!.id);
      if (formData.name) params.append('name', formData.name);
      if (formData.phone) params.append('phone', formData.phone);
      if (formData.gstin) params.append('gstin', formData.gstin);

      const res = await fetch(`/api/suppliers/check-duplicate?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch (error) {
      console.error('Error checking duplicates:', error);
    }
    return { hasDuplicates: false, duplicates: [] };
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business || !user?.id) return;

    const duplicateCheck = await checkDuplicates();
    if (duplicateCheck.hasDuplicates && duplicateCheck.duplicates.length > 0) {
      setDuplicateWarnings(duplicateCheck.duplicates);
      setShowDuplicateModal(true);
      return;
    }

    const stateCode = getStateCode(formData.state);
    const payload = {
      name: formData.name,
      phone: formData.phone || null,
      email: formData.email || null,
      address: formData.address || null,
      city: formData.city || null,
      state: formData.state || null,
      state_code: stateCode,
      pincode: formData.pincode || null,
      gstin: formData.gstin || null,
      opening_balance: parseFloat(formData.opening_balance) || 0,
      opening_balance_type: formData.opening_balance_type || 'credit',
      business_id: business.id,
      created_by: user.id,
      created_by_user_id: user.id,
      linked_business_id: linkedBusiness?.id || null,
      allow_low_stock_access: linkedBusiness ? formData.allow_low_stock_access : false,
    };

    try {
      const result = (await create(payload)) as { supplier?: { id: string } };
      const newSupplierId = result?.supplier?.id;
      if (!newSupplierId) {
        toast.error('Supplier created but failed to get ID. Please check the suppliers list.');
        router.push('/suppliers');
        return;
      }
      if (linkedBusiness && formData.allow_low_stock_access) {
        toast.success('Supplier created successfully! Access to low stock alerts has been granted.');
      } else {
        toast.success('Supplier created successfully!');
      }
      router.push(`/suppliers/${newSupplierId}`);
    } catch (error) {
      console.error('Error creating supplier:', error);
      toast.error('Failed to create supplier. Please try again.');
    }
  }

  const handleContinueAnyway = async () => {
    setShowDuplicateModal(false);
    await handleSubmit({ preventDefault: () => {} } as React.FormEvent);
  };
  
  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="purchases"
          action="create"
          details={reason}
          code="SUPPLIER_CREATE_DENIED"
        />
      
    );
  }

  return (
    
      <div className="w-full min-w-0 max-w-none">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link
            href="/suppliers"
            className="p-2 hover:bg-surface rounded-lg transition border border-border"
          >
            <ArrowLeft className="w-5 h-5 text-text-secondary" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Add New Supplier</h1>
            <p className="text-text-secondary text-sm mt-1">Enter supplier details</p>
          </div>
        </div>

        <Card className="p-6 sm:p-8 lg:p-10">
        <form onSubmit={handleSubmit}>
          <div className="form-page-shell">
          <FormSection
            title="Basic details"
            description="Supplier name and contact details used on purchase orders and payments."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6">
              <div className="sm:col-span-2 lg:col-span-3 space-y-0">
              <Input
                label="Supplier Name *"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="Enter supplier name"
                required
                disabled={!!linkedBusiness}
              />

              {!linkedBusiness && searchingBusinesses && formData.name.trim().length >= 2 && (
                <p className="mt-2 text-sm text-text-secondary flex items-center gap-2" aria-live="polite">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary-600" />
                  Checking for businesses already on Khatario…
                </p>
              )}

              {!linkedBusiness && visibleMatches.length > 0 && (
                <div className="mt-4 space-y-3" role="region" aria-label="Matching Khatario businesses">
                  {(() => {
                    const primary = visibleMatches[0];
                    const tier = matchTier(primary.match_confidence ?? 0);
                    const tierStyles =
                      tier === 'strong'
                        ? 'border-amber-400 bg-amber-50 shadow-md ring-2 ring-amber-200/80 dark:bg-amber-950/35 dark:border-amber-500 dark:ring-amber-900/50'
                        : tier === 'possible'
                          ? 'border-primary-400 bg-slate-50 shadow-sm ring-1 ring-primary-200 dark:bg-slate-800/35 dark:border-primary-600 dark:ring-primary-900/40'
                          : 'border-border bg-surface-muted ring-1 ring-border';

                    const headline =
                      tier === 'strong'
                        ? 'Likely the same business — link to avoid duplicates'
                        : tier === 'possible'
                          ? 'Possible match — confirm before you save'
                          : 'Similar business found';

                    const badgeClass =
                      tier === 'strong'
                        ? 'bg-amber-600 text-white font-semibold px-2.5 py-1'
                        : tier === 'possible'
                          ? 'bg-primary-600 text-white font-medium px-2.5 py-1'
                          : 'bg-gray-600 text-white px-2.5 py-1';

                    return (
                      <div
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                        className={`rounded-xl border-2 p-4 sm:p-5 ${tierStyles} transition-shadow`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/80 shadow-sm dark:bg-white/10">
                            <Building2 className="w-6 h-6 text-primary-600 dark:text-amber-400" aria-hidden />
                          </div>
                          <div className="min-w-0 flex-1 space-y-2">
                            <p className="text-sm font-semibold text-text-primary leading-snug">{headline}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-text-primary text-base">{primary.name}</span>
                              {primary.match_confidence != null && (
                                <span className={`text-xs rounded-md uppercase tracking-wide ${badgeClass}`}>
                                  {primary.match_confidence}% match
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-text-secondary">
                              {[primary.email, primary.phone].filter(Boolean).join(' · ')}
                              {(primary.city || primary.state) &&
                                ` · ${[primary.city, primary.state].filter(Boolean).join(', ')}`}
                            </p>
                            {primary.already_linked && (
                              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                                Already linked as a supplier — you cannot link again.
                              </p>
                            )}
                            <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-2">
                              <Button
                                type="button"
                                onClick={() => linkToBusiness(primary)}
                                disabled={primary.already_linked}
                                className="w-full sm:w-auto gap-2 bg-primary-600 hover:bg-primary-700"
                              >
                                <Link2 className="w-4 h-4" aria-hidden />
                                Link this business
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                onClick={() => dismissMatch(primary.id)}
                                className="w-full sm:w-auto text-text-secondary"
                              >
                                Different company — hide this suggestion
                              </Button>
                            </div>
                          </div>
                        </div>

                        {visibleMatches.length > 1 && (
                          <div className="mt-4 pt-3 border-t border-black/10 dark:border-white/10">
                            <button
                              type="button"
                              onClick={() => setShowExtraMatches((v) => !v)}
                              className="flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700"
                            >
                              {showExtraMatches ? (
                                <ChevronUp className="w-4 h-4" />
                              ) : (
                                <ChevronDown className="w-4 h-4" />
                              )}
                              {showExtraMatches ? 'Hide' : 'Show'}{' '}
                              {visibleMatches.length - 1} other suggestion
                              {visibleMatches.length - 1 === 1 ? '' : 's'}
                            </button>
                            {showExtraMatches && (
                              <ul className="mt-3 space-y-2">
                                {visibleMatches.slice(1).map((result: any) => (
                                  <li
                                    key={result.id}
                                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-border bg-white/60 dark:bg-black/20 p-3"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-medium text-text-primary">{result.name}</span>
                                        {result.match_confidence != null && (
                                          <span className="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded">
                                            {result.match_confidence}%
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs text-text-secondary mt-1 truncate">
                                        {[result.email, result.phone].filter(Boolean).join(' · ')}
                                      </p>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => linkToBusiness(result)}
                                        disabled={result.already_linked}
                                      >
                                        Link
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => dismissMatch(result.id)}
                                      >
                                        Dismiss
                                      </Button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              </div>
                <IntlPhoneInput
                  label="Phone"
                  value={formData.phone}
                  onChange={(full) => handleChange('phone', full)}
                  nationalPlaceholder="Mobile number"
                  disabled={!!linkedBusiness}
                />
                <Input
                  label="Email"
                  value={formData.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="Email address"
                  type="email"
                  inputMode="email"
                  disabled={!!linkedBusiness}
                />
            </div>
          </FormSection>

          {linkedBusiness ? (
            <FormSection
              title="Business linking"
              description="This supplier is linked to another business on Khatario for shared workflows."
            >
              <div className="bg-slate-50 border border-primary-200 rounded-lg p-4 space-y-4 dark:bg-slate-800/35 dark:border-primary-800">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="bg-slate-100 p-2 rounded-lg">
                    <svg className="w-5 h-5 text-primary-600" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-primary-900">Linked to Business Account</p>
                    <p className="text-sm text-primary-700 mt-1">{linkedBusiness.name}</p>
                    <p className="text-xs text-primary-600 mt-2">
                        Relationship established immediately.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={unlinkBusiness}
                  className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  Unlink
                </button>
                </div>
                
                {/* Low Stock Access Checkbox */}
                <div className="border-t border-primary-200 pt-4">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.allow_low_stock_access}
                      onChange={(e) => handleChange('allow_low_stock_access', e.target.checked)}
                      className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">Allow supplier to see low stock</p>
                      <p className="text-sm text-gray-600 mt-1">
                        When enabled, {linkedBusiness.name} will be able to view your low stock alerts and monitor your inventory levels through their supplier dashboard.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </FormSection>
          ) : null}

          <FormSection
            title="Address"
            description="Registered or usual billing location for this supplier."
          >
            <div className="grid grid-cols-1 gap-4 gap-y-6">
              <div className="sm:col-span-2 lg:col-span-3">
              <Input
                label="Address"
                value={formData.address}
                onChange={(e) => handleChange('address', e.target.value)}
                placeholder="Street address"
              />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 gap-y-6 sm:col-span-2 lg:col-span-3">
                <Input
                  label="City"
                  value={formData.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder="City"
                />
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    State
                  </label>
                  <select
                    value={formData.state}
                    onChange={(e) => handleChange('state', e.target.value)}
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
                <Input
                  label="Pincode"
                  value={formData.pincode}
                  onChange={(e) => handleChange('pincode', e.target.value)}
                  placeholder="Pincode"
                />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="GST & balance"
            description="Tax ID and opening balance for payables. Fetch GSTIN details when the API is available."
          >
            <div className="grid grid-cols-1 gap-4 gap-y-6">
              <div className="max-w-3xl">
                <label className="block text-sm font-medium text-text-secondary mb-1.5">
                  GSTIN
                </label>
                <div className="flex gap-2 relative flex-wrap sm:flex-nowrap">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={formData.gstin}
                      onChange={(e) => handleChange('gstin', e.target.value)}
                      placeholder="29ABCDE1234F1Z5"
                      maxLength={15}
                      className={`input w-full pr-10 transition-colors ${
                        gstinVerified 
                          ? 'border-green-500 focus:ring-green-500 bg-green-50' 
                          : gstinError
                          ? 'border-red-500 focus:ring-red-500 bg-red-50'
                          : ''
                      }`}
                    />
                    {gstinVerified && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
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
                {!gstinVerified && !gstinError && !gstinLoading && formData.gstin.length === 15 && (
                  <p className="mt-1.5 text-xs text-amber-600 font-medium flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    GSTIN format valid • API verification unavailable • You can still proceed
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 gap-y-6 max-w-2xl">
                <Input
                  label="Opening Balance"
                  value={formData.opening_balance}
                  onChange={(e) => handleChange('opening_balance', e.target.value)}
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                />
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1.5">
                    Balance type
                  </label>
                  <select
                    value={formData.opening_balance_type}
                    onChange={(e) => handleChange('opening_balance_type', e.target.value)}
                    className="input w-full"
                  >
                    <option value="credit">You Owe (Credit)</option>
                    <option value="debit">They Owe (Debit)</option>
                  </select>
                </div>
              </div>
            </div>
          </FormSection>

          </div>

          <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
            <Button type="button" variant="ghost" onClick={() => router.push('/suppliers')}>
              Cancel
            </Button>
            <Button type="submit" isLoading={saving}>
              {saving ? 'Creating...' : 'Create Supplier'}
            </Button>
          </div>
        </form>
        </Card>

        {/* Duplicate Warning Modal */}
        {showDuplicateModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="bg-yellow-100 p-2 rounded-lg">
                    <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">Similar Suppliers Found</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  We found {duplicateWarnings.length} similar supplier{duplicateWarnings.length > 1 ? 's' : ''} in your records. 
                  Please review to avoid duplicates.
                </p>
                <div className="space-y-3 mb-6">
                  {duplicateWarnings.map((dup: any) => (
                    <div key={dup.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{dup.name}</p>
                          <div className="mt-2 space-y-1 text-sm text-gray-600">
                            {dup.phone && <p>Phone: {dup.phone}</p>}
                            {dup.gstin && <p>GSTIN: {dup.gstin}</p>}
                            <p className="text-xs">
                              Match: {dup.match_confidence}% confidence
                              {dup.matched_fields.length > 0 && ` (${dup.matched_fields.join(', ')})`}
                              {dup.name_similarity && ` • Name similarity: ${dup.name_similarity}%`}
                            </p>
                          </div>
                        </div>
                        {dup.linked_business_id && (
                          <span className="px-2 py-1 text-xs bg-slate-100 text-primary-700 rounded">
                            Linked
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowDuplicateModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleContinueAnyway}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
                  >
                    Continue Anyway
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    
  );
}

