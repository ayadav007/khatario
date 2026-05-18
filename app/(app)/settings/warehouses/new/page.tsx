'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { FormPageContainer, FormCard, FormSection } from '@/components/ui/FormPageScaffold';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { INDIAN_STATES } from '@/lib/gst-utils';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';

export default function NewLocationPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const [saving, setSaving] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  
  // Check if multi_warehouse feature is enabled
  // Note: hasFeature() handles aliases, so both 'multi_warehouse' and 'settings_multi_warehouse' work
  const hasWarehouseAccess = hasFeature('multi_warehouse') || hasFeature('settings_multi_warehouse');
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'warehouses',
    action: 'create',
    skipCheck: !user?.id || !business?.id || !hasWarehouseAccess
  });
  const [isFirstWarehouse, setIsFirstWarehouse] = useState(false);
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [createdLocationId, setCreatedLocationId] = useState<string | null>(null);
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
  });

  useEffect(() => {
    if (business?.id && user?.id) {
      // Check if this is the first warehouse
      fetch(`/api/warehouses?business_id=${business.id}&user_id=${user.id}`)
        .then(res => {
          if (!res.ok) {
            // If 403, feature not enabled - that's handled by hasWarehouseAccess check
            return { warehouses: [] };
          }
          return res.json();
        })
        .then(data => {
          setIsFirstWarehouse((data.warehouses || []).length === 0);
        })
        .catch(err => console.error('Failed to check existing warehouses:', err));
    }
  }, [business?.id, user?.id]);

  function handleChange(field: string, value: string | boolean) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business) return;
    
    setSaving(true);

    if (!user?.id) {
      toast.error('User ID is required. Please refresh the page.');
      return;
    }

    try {
      const response = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          business_id: business.id,
          created_by: user.id, // Required for authorization
        }),
      });

      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        
        // Check if this is a feature access error
        if (
          response.status === 403 &&
          (errorData?.code === 'FEATURE_NOT_IN_PLAN' || errorData?.code === 'FEATURE_NOT_AVAILABLE')
        ) {
          setShowUpgradePrompt(true);
          return;
        }
        
        throw new Error(getApiErrorMessage(errorData, 'Failed to create warehouse'));
      }

      const data = await response.json();
      
      // If this is the first warehouse, show migration prompt
      if (isFirstWarehouse) {
        setCreatedLocationId(data.warehouse.id);
        setShowMigrationPrompt(true);
      } else {
        toast.success('Warehouse created successfully!');
        router.push('/settings/warehouses');
      }
    } catch (error: any) {
      console.error('Error creating warehouse:', error);
      toast.error(error.message || 'Failed to create warehouse. Please try again.');
    } finally {
      setSaving(false);
    }
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

  // Show authorization denied if user cannot create (PBAC failure)
  if (!canCreate) {
    return (
      
        <AccessDenied
          module="warehouses"
          action="create"
          details={reason}
          code="WAREHOUSE_CREATE_DENIED"
        />
      
    );
  }

  const handleMigrateStock = async () => {
    if (!business?.id || !createdLocationId) return;
    
    setMigrating(true);
    try {
      const response = await fetch('/api/locations/migrate-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          warehouse_id: createdLocationId, // This is actually a warehouse ID now
          location_id: createdLocationId, // Keep for backward compatibility
        }),
      });

      // Check if response is ok before trying to parse JSON
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (parseError) {
          // If JSON parsing fails, use status text
          throw new Error(`Failed to migrate stock: ${response.status} ${response.statusText}`);
        }
        throw new Error(errorData.error || errorData.details || 'Failed to migrate stock');
      }

      const data = await response.json();
      toast.success(data.message || 'Stock migrated successfully!');
      setShowMigrationPrompt(false);
      router.push('/settings/warehouses');
    } catch (error: any) {
      console.error('Error migrating stock:', error);
      toast.error(error.message || 'Failed to migrate stock. Please try again.');
    } finally {
      setMigrating(false);
    }
  };

  const handleSkipMigration = () => {
    setShowMigrationPrompt(false);
    router.push('/locations');
  };

  return (
    
      <FormPageContainer className="space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-4">
          <Link
            href="/settings/warehouses"
            className="p-2 hover:bg-surface rounded-lg transition border border-border"
          >
            <ArrowLeft className="w-5 h-5 text-text-secondary" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Add New Warehouse</h1>
            <p className="text-text-secondary text-sm mt-1">Enter warehouse details</p>
          </div>
        </div>

        <FormCard>
        <form onSubmit={handleSubmit}>
        <div className="form-page-shell">
          <FormSection
            title="Basic information"
            description="Name and optional code for reporting and transfers."
          >
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

          <FormSection
            title="Address"
            description="Physical or mailing location for this warehouse."
          >
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

          <FormSection
            title="Warehouse type"
            description="How stock at this location behaves in purchase and sales flows."
          >
            <div className="w-full max-w-3xl">
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
            </div>
          </FormSection>
        </div>

          <div className="flex justify-end gap-4 pt-4 mt-6 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push('/locations')}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={saving}
            >
              {saving ? 'Creating...' : 'Create Warehouse'}
            </Button>
          </div>
        </form>
        </FormCard>

        {/* Migration Prompt Modal */}
        {showMigrationPrompt && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-surface dark:bg-slate-900/70 rounded-lg p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-semibold text-text-primary mb-2">Migrate Existing Stock?</h3>
              <p className="text-sm text-text-secondary mb-4">
                You've created your first warehouse. Would you like to migrate all existing items' stock to this warehouse?
                This will move stock from items to location-based stock tracking.
              </p>
              <div className="flex justify-end space-x-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleSkipMigration}
                  disabled={migrating}
                >
                  Skip
                </Button>
                <Button
                  type="button"
                  onClick={handleMigrateStock}
                  disabled={migrating}
                >
                  {migrating ? 'Migrating...' : 'Migrate Stock'}
                </Button>
              </div>
            </div>
          </div>
        )}

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
      </FormPageContainer>
    
  );
}

