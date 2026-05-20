'use client';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput';
import { Button } from '@/components/ui/Button';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useRouter, useParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { INDIAN_STATES, getStateCode, getStateName } from '@/lib/gst-utils';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface Branch {
  id: string;
  name: string;
  branch_code: string | null;
  gstin: string | null;
  state_code: string | null;
  state: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  pincode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  branch_type: string;
  is_primary: boolean;
  invoice_prefix: string | null;
}

export default function EditBranchPage() {
  const router = useRouter();
  const params = useParams();
  const branchId = params.id as string;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<Branch | null>(null);
  
  // Check authorization before rendering form
  const { allowed: canUpdate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'settings',
    action: 'update',
    resourceId: branchId,
    skipCheck: !user?.id || !business?.id
  });

  useEffect(() => {
    if (business?.id && branchId) {
      fetchBranch();
    }
  }, [business, branchId]);

  async function fetchBranch() {
    if (!business?.id || !branchId) return;
    
    try {
      const response = await fetch(`/api/branches/${branchId}?business_id=${business.id}`);
      if (response.ok) {
        const data = await response.json();
        setFormData(data.branch);
      } else {
        toast.error('Branch not found');
        router.push('/branches');
      }
    } catch (error) {
      console.error('Error fetching branch:', error);
      toast.error('Failed to load branch');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(field: string, value: string | boolean) {
    if (!formData) return;
    setFormData((prev) => ({ ...prev, [field]: value } as Branch));
    
    // Auto-fill state when state_code changes
    if (field === 'state_code') {
      const stateName = getStateName(String(value));
      if (stateName) {
        setFormData((prev) => ({ ...prev, state: stateName } as Branch));
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id || !formData) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/branches/${branchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          name: formData.name,
          branch_code: formData.branch_code || null,
          gstin: formData.gstin || null,
          state_code: formData.state_code || null,
          state: formData.state || null,
          address_line1: formData.address_line1 || null,
          address_line2: formData.address_line2 || null,
          city: formData.city || null,
          pincode: formData.pincode || null,
          country: formData.country || 'India',
          phone: formData.phone || null,
          email: formData.email || null,
          branch_type: formData.branch_type || 'retail',
          is_primary: formData.is_primary,
          invoice_prefix: formData.invoice_prefix || null,
        }),
      });

      if (response.ok) {
        router.push('/settings/branches');
        router.refresh();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to update branch');
      }
    } catch (error) {
      console.error('Error updating branch:', error);
      toast.error('Failed to update branch');
    } finally {
      setSaving(false);
    }
  }

  // Show loading state while checking authorization
  if (authLoading || loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      
    );
  }

  // Show authorization denied if user cannot update
  if (!canUpdate) {
    return (
      
        <AccessDenied
          module="settings"
          action="update"
          details={reason}
          code="BRANCH_UPDATE_DENIED"
        />
      
    );
  }

  if (!formData) {
    return (
      
        <div className={`${SETTINGS_CONTENT_WIDTH} py-8`}>
          <p className="text-text-secondary">Branch not found</p>
        </div>
      
    );
  }

  return (
    <FormPageContainer className="py-6 space-y-6">
        <MobileDuplicatePageChrome
          title="Edit branch"
          description="Update branch information and settings"
        />

        <FormCard>
        <form onSubmit={handleSubmit}>
        <div className="form-page-shell">
          <FormSection title="Basic information" description="Branch name, code, and primary flag.">
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
                  value={formData.branch_code || ''}
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

          <FormSection title="GST & tax" description="GSTIN and state for compliance.">
            <div className="grid grid-cols-1 gap-4 gap-y-6">
              <Input
                label="GSTIN"
                value={formData.gstin || ''}
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
                    value={formData.state_code || ''}
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
                  value={formData.state || ''}
                  onChange={(e) => handleChange('state', e.target.value)}
                  placeholder="Auto-filled from state code"
                  readOnly
                />
              </div>
            </div>
          </FormSection>

          <FormSection title="Address" description="Registered or operating address.">
            <div className="grid grid-cols-1 gap-4 gap-y-6">
              <Input
                label="Address Line 1"
                value={formData.address_line1 || ''}
                onChange={(e) => handleChange('address_line1', e.target.value)}
                placeholder="Street address"
              />
              <Input
                label="Address Line 2"
                value={formData.address_line2 || ''}
                onChange={(e) => handleChange('address_line2', e.target.value)}
                placeholder="Area, Landmark"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="City"
                  value={formData.city || ''}
                  onChange={(e) => handleChange('city', e.target.value)}
                  placeholder="City"
                />
                <Input
                  label="Pincode"
                  value={formData.pincode || ''}
                  onChange={(e) => handleChange('pincode', e.target.value)}
                  placeholder="PIN code"
                  maxLength={6}
                />
              </div>
              <Input
                label="Country"
                value={formData.country || 'India'}
                onChange={(e) => handleChange('country', e.target.value)}
                placeholder="Country"
              />
            </div>
          </FormSection>

          <FormSection title="Contact" description="Branch phone and email.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 gap-y-6">
              <IntlPhoneInput
                label="Phone"
                value={formData.phone || ''}
                onChange={(full) => handleChange('phone', full)}
                nationalPlaceholder="Mobile number"
              />
              <Input
                label="Email"
                type="email"
                value={formData.email || ''}
                onChange={(e) => handleChange('email', e.target.value)}
                placeholder="Email address"
              />
            </div>
          </FormSection>

          <FormSection title="Invoice settings" description="Optional prefix for invoice series.">
            <div className="w-full max-w-2xl">
              <Input
                label="Invoice Prefix"
                value={formData.invoice_prefix || ''}
                onChange={(e) => handleChange('invoice_prefix', e.target.value.toUpperCase())}
                placeholder="e.g., MUM, DEL"
                helperText="Prefix for branch-specific invoice numbering"
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
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </form>
        </FormCard>
    </FormPageContainer>
  );
}
