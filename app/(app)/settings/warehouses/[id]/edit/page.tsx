'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, Loader2, Building2 } from 'lucide-react';
import { WarehouseBranchLinks } from '@/components/settings/WarehouseBranchLinks';
import { Card } from '@/components/ui/Card';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import Link from 'next/link';
import { INDIAN_STATES } from '@/lib/gst-utils';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';

export default function EditWarehousePage() {
  const router = useRouter();
  const params = useParams();
  const warehouseId = params?.id as string;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [showBranchLinksModal, setShowBranchLinksModal] = useState(false);
  
  // Check if multi_warehouse feature is enabled
  const hasWarehouseAccess = hasFeature('multi_warehouse') || hasFeature('settings_multi_warehouse');
  
  // Check authorization before rendering form
  const { allowed: canUpdate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'warehouses',
    action: 'update',
    skipCheck: !user?.id || !business?.id || !hasWarehouseAccess || !warehouseId
  });

  const [formData, setFormData] = useState({
    name: '',
    warehouse_code: '',
    branch_id: null as string | null,
    address_line1: '',
    address_line2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India',
    warehouse_type: 'physical' as 'physical' | 'virtual' | 'damaged_holding',
    is_active: true,
  });

  useEffect(() => {
    if (business?.id && user?.id && warehouseId && hasWarehouseAccess) {
      fetchWarehouse();
    } else if (!hasWarehouseAccess) {
      setLoading(false);
    }
  }, [business?.id, user?.id, warehouseId, hasWarehouseAccess]);

  async function fetchWarehouse() {
    if (!business?.id || !user?.id || !warehouseId) return;

    try {
      const response = await fetch(
        `/api/warehouses/${warehouseId}?business_id=${business.id}&user_id=${user.id}`
      );

      if (!response.ok) {
        const errorData = await response.json();
        if (
          response.status === 403 &&
          (errorData.code === 'FEATURE_NOT_IN_PLAN' || errorData.code === 'FEATURE_NOT_AVAILABLE')
        ) {
          setShowUpgradePrompt(true);
          return;
        }
        throw new Error(errorData.error || 'Failed to fetch warehouse');
      }

      const data = await response.json();
      const warehouse = data.warehouse;

      setFormData({
        name: warehouse.name || '',
        warehouse_code: warehouse.warehouse_code || '',
        branch_id: warehouse.branch_id || null,
        address_line1: warehouse.address_line1 || '',
        address_line2: warehouse.address_line2 || '',
        city: warehouse.city || '',
        state: warehouse.state || '',
        pincode: warehouse.pincode || '',
        country: warehouse.country || 'India',
        warehouse_type: warehouse.warehouse_type || 'physical',
        is_active: warehouse.is_active !== false,
      });
    } catch (error) {
      console.error('Error fetching warehouse:', error);
      toast.error('Failed to load warehouse details. Please try again.');
      router.push('/settings/warehouses');
    } finally {
      setLoading(false);
    }
  }

  function handleChange(field: string, value: string | boolean | null) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business || !user?.id || !warehouseId) return;
    
    setSaving(true);

    try {
      const response = await fetch(`/api/warehouses/${warehouseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          business_id: business.id,
          updated_by: user.id, // Required for authorization
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        
        // Check if this is a feature access error
        if (
          response.status === 403 &&
          (errorData.code === 'FEATURE_NOT_IN_PLAN' || errorData.code === 'FEATURE_NOT_AVAILABLE')
        ) {
          setShowUpgradePrompt(true);
          return;
        }
        
        throw new Error(errorData.error || 'Failed to update warehouse');
      }

      const data = await response.json();
      toast.success('Warehouse updated successfully!');
      router.push('/settings/warehouses');
    } catch (error: any) {
      console.error('Error updating warehouse:', error);
      toast.error(error.message || 'Failed to update warehouse. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // Show loading state while checking features
  if (featuresLoading || authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <p className="text-text-secondary mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  // Show upgrade prompt if warehouse feature is not available
  if (!hasWarehouseAccess) {
    return (
      <>
        <UpgradePrompt
          limitType="feature"
          featureName="Warehouses"
          featureKey="settings_multi_warehouse"
          onClose={() => router.push('/settings/warehouses')}
          onPurchaseSuccess={async () => {
            window.location.reload();
          }}
        />
      </>
    );
  }

  // Show access denied if user doesn't have update permission
  if (!canUpdate) {
    return <AccessDenied message="Access Denied" details={reason} module="warehouses" action="update" />;
  }

  return (
    <FormPageContainer className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link
          href="/settings/warehouses"
          className="p-2 hover:bg-surface rounded-lg transition border border-border"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Edit Warehouse</h1>
          <p className="text-text-secondary text-sm mt-1">Update warehouse details</p>
        </div>
      </div>

      <FormCard>
      <form onSubmit={handleSubmit}>
      <div className="form-page-shell">
        <FormSection title="Basic information" description="Name and code for this warehouse.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 gap-y-6">
            <Input
              label="Warehouse Name *"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Enter warehouse name"
              required
            />
            <Input
              label="Warehouse Code"
              value={formData.warehouse_code}
              onChange={(e) => handleChange('warehouse_code', e.target.value)}
              placeholder="e.g., WH-001"
            />
          </div>
        </FormSection>

        <FormSection title="Address" description="Location details for reference and documents.">
          <div className="grid grid-cols-1 gap-4 gap-y-6">
            <Input
              label="Address Line 1"
              value={formData.address_line1}
              onChange={(e) => handleChange('address_line1', e.target.value)}
              placeholder="Street address, building number"
            />
            <Input
              label="Address Line 2"
              value={formData.address_line2}
              onChange={(e) => handleChange('address_line2', e.target.value)}
              placeholder="Apartment, suite, unit, etc."
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 gap-y-6">
              <Input
                label="City"
                value={formData.city}
                onChange={(e) => handleChange('city', e.target.value)}
                placeholder="City"
              />
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">State</label>
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
                type="tel"
                inputMode="numeric"
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

        <FormSection title="Warehouse type & status" description="How this location is used and whether it is active.">
          <div className="grid w-full max-w-3xl grid-cols-1 gap-4 md:grid-cols-2 md:items-end">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Warehouse Type *</label>
              <select
                value={formData.warehouse_type}
                onChange={(e) => handleChange('warehouse_type', e.target.value as 'physical' | 'virtual' | 'damaged_holding')}
                className="input w-full"
                required
              >
                <option value="physical">Physical Warehouse</option>
                <option value="virtual">Virtual Warehouse (Dropshipping)</option>
                <option value="damaged_holding">Damaged Goods Holding</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => handleChange('is_active', e.target.checked)}
                className="w-4 h-4 text-primary-600 border-border rounded focus:ring-primary-500"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-text-primary">
                Active warehouse
              </label>
            </div>
          </div>
        </FormSection>

        <FormSection title="Linked branches" description="Control which branches can use stock at this warehouse.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">Open the manager to attach or detach branches.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowBranchLinksModal(true)}
            >
              <Building2 className="w-4 h-4 mr-2" />
              Manage branch links
            </Button>
          </div>
        </FormSection>
      </div>

        <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/settings/warehouses')}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </form>
      </FormCard>

      {/* Upgrade Prompt Modal */}
      {showUpgradePrompt && (
        <UpgradePrompt
          limitType="feature"
          featureName="Warehouses"
          featureKey="settings_multi_warehouse"
          onClose={() => setShowUpgradePrompt(false)}
          onPurchaseSuccess={async () => {
            window.location.reload();
          }}
        />
      )}

      {/* Branch Links Modal */}
      {showBranchLinksModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <WarehouseBranchLinks
                warehouseId={warehouseId}
                onClose={() => setShowBranchLinksModal(false)}
              />
            </div>
          </Card>
        </div>
      )}
    </FormPageContainer>
  );
}
