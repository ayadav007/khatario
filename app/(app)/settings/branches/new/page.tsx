'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { INDIAN_STATES, getStateCode, getStateName } from '@/lib/gst-utils';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function NewBranchPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature } = useFeatureRegistry();
  const [saving, setSaving] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [formData, setFormData] = useState({
    name: '',
    branch_code: '',
    gstin: '',
    state_code: '',
    state: '',
    address_line1: '',
    address_line2: '',
    city: '',
    pincode: '',
    country: 'India',
    phone: '',
    email: '',
    branch_type: 'retail',
    is_primary: false,
    invoice_prefix: '',
  });

  // Check if multi_branch feature is enabled
  const hasAccess = hasFeature('multi_branch') || hasFeature('settings_multi_branch');

  // Show authorization denied if user cannot create
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="settings"
          action="create"
          details={reason}
          code="SETTINGS_CREATE_DENIED"
        />
      
    );
  }

  function handleChange(field: string, value: string | boolean) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    
    // Auto-fill state when state_code changes
    if (field === 'state_code') {
      const stateName = getStateName(String(value));
      if (stateName) {
        setFormData((prev) => ({ ...prev, state: stateName }));
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const response = await fetch('/api/branches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          ...formData,
          created_by_user_id: user?.id, // Required for authorization
          gstin: formData.gstin || null,
          state_code: formData.state_code || null,
          state: formData.state || null,
          address_line1: formData.address_line1 || null,
          address_line2: formData.address_line2 || null,
          city: formData.city || null,
          pincode: formData.pincode || null,
          phone: formData.phone || null,
          email: formData.email || null,
          branch_code: formData.branch_code || null,
          invoice_prefix: formData.invoice_prefix || null,
        }),
      });

      if (response.ok) {
        router.push('/settings/branches');
        router.refresh();
      } else {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Failed to create branch'));
      }
    } catch (error) {
      console.error('Error creating branch:', error);
      toast.error('Failed to create branch');
    } finally {
      setSaving(false);
    }
  }


  if (!hasAccess) {
    return (
      
        <div className={`${SETTINGS_CONTENT_WIDTH} py-8 flex justify-center`}>
          <div className="max-w-2xl w-full bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border p-8 text-center">
            <h2 className="text-2xl font-bold text-text-primary mb-2">
              Multi-Branch Feature is Locked
            </h2>
            <p className="text-text-secondary mb-6">
              Upgrade to Enterprise plan to unlock multi-branch support.
            </p>
            <button
              onClick={() => router.push('/settings/subscription')}
              className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              Upgrade to Enterprise
            </button>
          </div>
        </div>
      
    );
  }

  return (
    <FormPageContainer className="py-6 space-y-6">
        <MobileDuplicatePageChrome
          title="Create branch"
          description="Add a new branch office for accounting and compliance purposes"
        />

        <FormCard>
        <form onSubmit={handleSubmit}>
        <div className="form-page-shell">
          <FormSection title="Basic information" description="Branch identity and whether it is the primary branch.">
            <div className="grid grid-cols-1 gap-4 gap-y-6">
              <Input
                label="Branch Name *"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                placeholder="e.g., Mumbai Branch"
                required
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Branch Code"
                  value={formData.branch_code}
                  onChange={(e) => handleChange('branch_code', e.target.value)}
                  placeholder="e.g., MUM-001"
                />
                <div className="flex items-center space-x-2 pt-6">
                  <input
                    type="checkbox"
                    id="is_primary"
                    checked={formData.is_primary}
                    onChange={(e) => handleChange('is_primary', e.target.checked)}
                    className="w-4 h-4 text-primary-600 border-border rounded focus:ring-primary-500"
                  />
                  <label htmlFor="is_primary" className="text-sm font-medium text-text-primary">
                    Set as Primary Branch
                  </label>
                </div>
              </div>
            </div>
          </FormSection>

          <FormSection title="GST & tax" description="GSTIN and state for returns and e-invoicing.">
            <div className="grid grid-cols-1 gap-4 gap-y-6">
              <Input
                label="GSTIN"
                value={formData.gstin}
                onChange={(e) => handleChange('gstin', e.target.value.toUpperCase())}
                placeholder="27ABCDE1234F1Z5"
                maxLength={15}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    State Code *
                  </label>
                  <select
                    value={formData.state_code}
                    onChange={(e) => handleChange('state_code', e.target.value)}
                    className="input w-full"
                    required
                  >
                    <option value="">Select State</option>
                    {INDIAN_STATES.map((state) => {
                      const code = getStateCode(state);
                      return (
                        <option key={code} value={code}>
                          {code} - {state}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <Input
                  label="State"
                  value={formData.state}
                  onChange={(e) => handleChange('state', e.target.value)}
                  placeholder="Auto-filled from state code"
                  readOnly
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Address" description="Registered or operating address for this branch.">
            <div className="grid grid-cols-1 gap-4 gap-y-6">
              <Input
                label="Address Line 1"
                value={formData.address_line1}
                onChange={(e) => handleChange('address_line1', e.target.value)}
                placeholder="Street address"
              />
              <Input
                label="Address Line 2"
                value={formData.address_line2}
                onChange={(e) => handleChange('address_line2', e.target.value)}
                placeholder="Area, Landmark"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="City"
                  value={formData.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder="City"
                />
                <Input
                  label="Pincode"
                  value={formData.pincode}
                  onChange={(e) => handleChange('pincode', e.target.value)}
                  placeholder="PIN code"
                  maxLength={6}
                />
              </div>
              <Input
                label="Country"
                value={formData.country}
                onChange={(e) => handleChange('country', e.target.value)}
                placeholder="Country"
              />
            </div>
          </FormSection>

          <FormSection title="Contact" description="Branch phone and email for correspondence.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 gap-y-6">
              <IntlPhoneInput
                label="Phone"
                value={formData.phone}
                onChange={(full) => handleChange('phone', full)}
                nationalPlaceholder="Mobile number"
              />
              <Input
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="Email address"
              />
            </div>
          </FormSection>

          <FormSection title="Invoice settings" description="Optional prefix for branch-specific invoice series.">
            <div className="w-full max-w-2xl">
              <Input
                label="Invoice Prefix"
                value={formData.invoice_prefix}
                onChange={(e) => handleChange('invoice_prefix', e.target.value.toUpperCase())}
                placeholder="e.g., MUM, DEL"
                helperText="Prefix for branch-specific invoice numbering (e.g., MUM-001, DEL-001)"
              />
            </div>
          </FormSection>
        </div>

          <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push('/settings/branches')}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                'Create Branch'
              )}
            </Button>
          </div>
        </form>
        </FormCard>
    </FormPageContainer>
  );
}
