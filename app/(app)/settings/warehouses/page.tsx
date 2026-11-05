'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, MapPin, Phone, Mail, CheckCircle, Package, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { useRouter } from 'next/navigation';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { UpgradePrompt } from '@/components/subscription/UpgradePrompt';
import { Button } from '@/components/ui/Button';
import { InfoCallout } from '@/components/ui/InfoCallout';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

interface Location {
  id: string;
  name: string;
  location_code: string;
  is_primary: boolean;
  address_line1: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  is_active: boolean;
  /** Set when the godown sits outside its GST registration's state. */
  gst_place_issue?: string | null;
  linked_branches?: Array<{
    branch_id: string;
    branch_name: string;
    branch_code?: string;
    is_primary: boolean;
  }>;
}

export default function LocationsPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature, loading: featuresLoading } = useFeatureRegistry();
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [migratingWarehouseId, setMigratingWarehouseId] = useState<string | null>(null);
  const [deletingWarehouseId, setDeletingWarehouseId] = useState<string | null>(null);

  // Check if multi_warehouse feature is enabled
  // Note: hasFeature() handles aliases, so both 'multi_warehouse' and 'settings_multi_warehouse' work
  const hasWarehouseAccess = hasFeature('multi_warehouse') || hasFeature('settings_multi_warehouse');

  useEffect(() => {
    if (business?.id && hasWarehouseAccess) {
      fetchLocations();
    } else if (business?.id && !hasWarehouseAccess) {
      setLoading(false);
    }
  }, [business, hasWarehouseAccess]);

  async function fetchLocations() {
    if (!hasWarehouseAccess || !business?.id || !user?.id) {
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/warehouses?business_id=${business.id}&user_id=${user.id}`);
      
      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        if (
          response.status === 403 &&
          (errorData?.code === 'FEATURE_NOT_IN_PLAN' || errorData?.code === 'FEATURE_NOT_AVAILABLE')
        ) {
          setShowUpgradePrompt(true);
          return;
        }
        throw new Error(getApiErrorMessage(errorData, 'Failed to fetch warehouses'));
      }
      
      const data = await response.json();
      
      // Fetch branch links for each warehouse
      const branchLinksPromises = (data.warehouses || []).map(async (w: any) => {
        try {
          const linksResponse = await fetch(
            `/api/warehouses/${w.id}/branches?business_id=${business.id}&user_id=${user.id}`
          );
          if (linksResponse.ok) {
            const linksData = await linksResponse.json();
            // Filter to only show linked branches (is_linked = true)
            const linkedBranches = (linksData.branches || [])
              .filter((b: any) => b.is_linked)
              .map((b: any) => ({
                branch_id: b.id,
                branch_name: b.name,
                branch_code: b.branch_code,
                is_primary: b.is_primary
              }));
            return {
              warehouse_id: w.id,
              branches: linkedBranches
            };
          } else {
            const errorData = await safeJsonParse(linksResponse);
            console.error(`Error fetching branch links for warehouse ${w.id}:`, errorData);
          }
        } catch (error) {
          console.error(`Error fetching branch links for warehouse ${w.id}:`, error);
        }
        return { warehouse_id: w.id, branches: [] };
      });
      
      const branchLinksResults = await Promise.all(branchLinksPromises);
      const branchLinksMap = new Map(
        branchLinksResults.map(r => [r.warehouse_id, r.branches])
      );
      
      // Map warehouses to Location interface for compatibility
      const mappedLocations = (data.warehouses || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        location_code: w.warehouse_code || '',
        is_primary: false, // Warehouses don't have is_primary, branches do
        address_line1: w.address_line1 || '',
        city: w.city || '',
        state: w.state || '',
        pincode: w.pincode || '',
        phone: '', // Warehouses don't have phone in the new schema
        email: '', // Warehouses don't have email in the new schema
        is_active: w.is_active !== false,
        gst_place_issue: w.gst_place_issue || null,
        linked_branches: branchLinksMap.get(w.id) || []
      }));
      setLocations(mappedLocations);
    } catch (error) {
      console.error('Error fetching locations:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleMigrateStock = async (warehouseId: string) => {
    if (!business?.id) return;

    setMigratingWarehouseId(warehouseId);
    try {
      const response = await fetch('/api/locations/migrate-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          warehouse_id: warehouseId,
          location_id: warehouseId, // Keep for backward compatibility
        }),
      });

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (parseError) {
          throw new Error(`Failed to migrate stock: ${response.status} ${response.statusText}`);
        }
        throw new Error(errorData.error || errorData.details || 'Failed to migrate stock');
      }

      const data = await response.json();
      toast.success(data.message || `Successfully migrated ${data.migrated_count || 0} items to warehouse!`);
      
      // Optionally refresh the page to show updated stock
      // router.refresh();
    } catch (error: any) {
      console.error('Error migrating stock:', error);
      toast.error(error.message || 'Failed to migrate stock. Please try again.');
    } finally {
      setMigratingWarehouseId(null);
    }
  };

  const handleDeleteWarehouse = async (warehouseId: string, warehouseName: string) => {
    if (!business?.id || !user?.id) return;

    // Confirm deletion
    const confirmed = confirm(
      `Are you sure you want to delete "${warehouseName}"?\n\n` +
      `This action cannot be undone. The warehouse will only be deleted if:\n` +
      `- It has no stock\n` +
      `- It has no active transfers`
    );

    if (!confirmed) return;

    setDeletingWarehouseId(warehouseId);
    try {
      const response = await fetch(
        `/api/warehouses/${warehouseId}?business_id=${business.id}&user_id=${user.id}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const errorData = await safeJsonParse(response);
        throw new Error(getApiErrorMessage(errorData, 'Failed to delete warehouse'));
      }

      // Refresh the list
      await fetchLocations();
      toast.success(`Warehouse "${warehouseName}" deleted successfully`);
    } catch (error: any) {
      console.error('Error deleting warehouse:', error);
      toast.error(error.message || 'Failed to delete warehouse. Please try again.');
    } finally {
      setDeletingWarehouseId(null);
    }
  };

  // Show loading state while checking features
  if (featuresLoading) {
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
          onClose={() => router.push('/settings')}
          onPurchaseSuccess={async () => {
            window.location.reload();
          }}
        />
      </>
    );
  }

  return (
      <SettingsPageShell
        title="Warehouses"
        description="Manage multiple warehouses and godowns"
        icon={MapPin}
        actions={
          <Button onClick={() => router.push('/settings/warehouses/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Add warehouse
          </Button>
        }
      >

        {/* Enterprise Feature Banner */}
        <InfoCallout tone="neutral" icon={MapPin} title="About warehouses">
          Multi-warehouse support lets you manage inventory and sales across multiple warehouses, godowns or storage locations.
        </InfoCallout>

        {/* Locations Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {loading ? (
            <div className="col-span-full p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : locations.length === 0 ? (
            <EmptyState
              className="card col-span-full"
              icon={MapPin}
              title="No warehouses yet"
              description="Add a warehouse or godown to track stock by location."
              action={<Button onClick={() => router.push('/settings/warehouses/new')}>Add your first warehouse</Button>}
            />
          ) : (
            locations.map((location) => (
              <div
                key={location.id}
                className="card min-w-0 p-4 transition hover:shadow-md md:p-5"
              >
                {/* Header */}
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">
                      <MapPin className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-text-primary" title={location.name}>{location.name}</h3>
                      {location.location_code && (
                        <p className="text-xs text-text-muted">{location.location_code}</p>
                      )}
                    </div>
                  </div>
                  {location.is_primary && (
                    <div className="flex shrink-0 items-center space-x-1 px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 rounded-full text-xs font-medium">
                      <CheckCircle className="w-3 h-3" />
                      <span>Primary</span>
                    </div>
                  )}
                </div>

{location.gst_place_issue && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-800 dark:text-red-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{location.gst_place_issue}</span>
                  </div>
                )}

                {/* Address */}
                <div className="mb-4">
                  <p className="text-sm text-text-secondary">
                    {location.address_line1}
                    {location.city && `, ${location.city}`}
                    {location.state && `, ${location.state}`}
                    {location.pincode && ` - ${location.pincode}`}
                  </p>
                </div>

                {/* Linked Branches */}
                {location.linked_branches && location.linked_branches.length > 0 && (
                  <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg border border-primary-100 dark:border-slate-600">
                    <p className="text-xs font-semibold text-primary-900 dark:text-primary-200 uppercase mb-2">Linked to Branches:</p>
                    <div className="space-y-1">
                      {location.linked_branches.map((branch) => (
                        <div key={branch.branch_id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-primary-800 dark:text-primary-200">
                            {branch.branch_name}
                            {branch.branch_code && ` (${branch.branch_code})`}
                          </span>
                          {branch.is_primary && (
                            <span className="shrink-0 rounded-full bg-primary-200 px-2 py-0.5 text-xs font-medium text-primary-900 dark:bg-slate-700 dark:text-primary-200">
                              ⭐ Primary
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {location.linked_branches && location.linked_branches.length === 0 && (
                  <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/30 rounded-lg border border-yellow-100 dark:border-yellow-800/60">
                    <p className="text-xs text-yellow-800 dark:text-yellow-300">
                      ⚠️ Not linked to any branch. Link this warehouse to branches to use it in invoices.
                    </p>
                  </div>
                )}

                {/* Contact */}
                <div className="space-y-2">
                  {location.phone && (
                    <div className="flex items-center space-x-2 text-sm text-text-secondary">
                      <Phone className="w-4 h-4" />
                      <span>{location.phone}</span>
                    </div>
                  )}
                  {location.email && (
                    <div className="flex items-center space-x-2 text-sm text-text-secondary">
                      <Mail className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 break-all">{location.email}</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-4 pt-4 border-t border-border space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/reports/stock/valuation?warehouse_id=${location.id}`)}
                    >
                      View stock
                    </Button>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => router.push(`/settings/warehouses/${location.id}/edit`)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteWarehouse(location.id, location.name)}
                        disabled={deletingWarehouseId === location.id}
                        className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        {deletingWarehouseId === location.id ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('This will move all existing product stock from the items table to this warehouse. Continue?')) {
                        handleMigrateStock(location.id);
                      }
                    }}
                    disabled={migratingWarehouseId === location.id}
                    className="w-full min-h-11 flex items-center justify-center space-x-2 px-3 py-2 text-sm bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-950/30 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Package className="w-4 h-4" />
                    <span>
                      {migratingWarehouseId === location.id ? 'Migrating...' : 'Migrate Stock'}
                    </span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

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
      </SettingsPageShell>
  );
}

