'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, Building2, Phone, Mail, CheckCircle, Edit, Trash2, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { useRouter } from 'next/navigation';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Button } from '@/components/ui/Button';
import { InfoCallout } from '@/components/ui/InfoCallout';
import { EmptyState } from '@/components/ui/EmptyState';
import { PlanFeatureDeniedCallout } from '@/components/subscription/PlanFeatureDeniedCallout';

interface Branch {
  id: string;
  name: string;
  branch_code: string | null;
  gstin: string | null;
  state_code: string | null;
  state: string | null;
  address_line1: string | null;
  city: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  is_active: boolean;
  invoice_prefix: string | null;
  next_invoice_number: number;
  /** Set when the branch breaks the per-state GST registration rule. */
  gst_place_issue?: string | null;
}

export default function BranchesPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const { hasFeature } = useFeatureRegistry();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Check if multi_branch feature is enabled
  const hasAccess = hasFeature('multi_branch') || hasFeature('settings_multi_branch');

  useEffect(() => {
    if (business?.id && hasAccess) {
      fetchBranches();
    } else if (business?.id && !hasAccess) {
      setLoading(false);
    }
  }, [business, hasAccess]);

  async function fetchBranches() {
    if (!business?.id) return;
    
    try {
      const response = await fetch(`/api/branches?business_id=${business.id}&user_id=${user?.id}`);
      const data = await response.json();
      setBranches(data.branches || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleDelete = async (branchId: string) => {
    if (!business?.id) return;
    
    const branch = branches.find(b => b.id === branchId);
    if (!branch) return;
    
    if (branch.is_primary) {
      toast.warning('Cannot delete primary branch. Set another branch as primary first.');
      return;
    }
    
    if (!confirm(`Are you sure you want to delete branch "${branch.name}"? This action cannot be undone.`)) {
      return;
    }
    
    setDeleting(branchId);
    try {
      const response = await fetch(`/api/branches/${branchId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id })
      });
      
      if (response.ok) {
        await fetchBranches();
      } else {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Failed to delete branch'));
      }
    } catch (error) {
      console.error('Error deleting branch:', error);
      toast.error('Failed to delete branch');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggleActive = async (branchId: string, currentStatus: boolean) => {
    if (!business?.id) return;
    
    try {
      const response = await fetch(`/api/branches/${branchId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          is_active: !currentStatus
        })
      });
      
      if (response.ok) {
        await fetchBranches();
      } else {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Failed to update branch'));
      }
    } catch (error) {
      console.error('Error updating branch:', error);
      toast.error('Failed to update branch');
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      
    );
  }

  if (!hasAccess) {
    return (
      
        <SettingsPageShell title="Branches" description="Manage branch offices and accounting units" icon={Building2}>
          <PlanFeatureDeniedCallout
            featureKey="multi_branch"
            title="Branches need a higher plan"
            description="Upgrade to unlock multi-branch support, branch-wise accounting and consolidated reporting."
          />
        </SettingsPageShell>
      
    );
  }

  return (
      <SettingsPageShell
        title="Branches"
        description="Manage branch offices and accounting units"
        icon={Building2}
        actions={
          <Button onClick={() => router.push('/settings/branches/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Add branch
          </Button>
        }
      >

        {/* Info Banner */}
        <InfoCallout tone="neutral" icon={Building2} title="About branches">
          Branches are accounting and compliance units. Each branch can have its own GSTIN, invoice numbering, and financial statements.
          Warehouses are physical storage locations that can be linked to branches.
        </InfoCallout>

        {/* Branches Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {branches.length === 0 ? (
            <EmptyState
              className="card col-span-full"
              icon={Building2}
              title="No branches yet"
              description="Create your first branch to get started."
              action={<Button onClick={() => router.push('/settings/branches/new')}>Add your first branch</Button>}
            />
          ) : (
            branches.map((branch) => (
              <div
                key={branch.id}
                className="card min-w-0 p-4 transition hover:shadow-md md:p-5"
              >
                {/* Header */}
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">
                      <Building2 className="w-5 h-5 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-text-primary" title={branch.name}>{branch.name}</h3>
                      {branch.branch_code && (
                        <p className="text-xs text-text-muted">{branch.branch_code}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {branch.is_primary && (
                      <div className="flex items-center space-x-1 px-2 py-1 bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 rounded-full text-xs font-medium">
                        <CheckCircle className="w-3 h-3" />
                        <span>Primary</span>
                      </div>
                    )}
                    {!branch.is_active && (
                      <div className="flex items-center space-x-1 px-2 py-1 bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 rounded-full text-xs font-medium">
                        <XCircle className="w-3 h-3" />
                        <span>Inactive</span>
                      </div>
                    )}
                  </div>
                </div>

{branch.gst_place_issue && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 p-2 text-xs text-red-800 dark:text-red-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{branch.gst_place_issue}</span>
                  </div>
                )}

                {/* GSTIN */}
                {branch.gstin && (
                  <div className="mb-3">
                    <p className="text-xs text-text-muted">GSTIN</p>
                    <p className="text-sm font-medium text-text-primary">{branch.gstin}</p>
                  </div>
                )}

                {/* Address */}
                {(branch.address_line1 || branch.city || branch.state) && (
                  <div className="mb-3">
                    <p className="text-xs text-text-muted">Address</p>
                    <p className="text-sm text-text-secondary">
                      {branch.address_line1}
                      {branch.city && `, ${branch.city}`}
                      {branch.state && `, ${branch.state}`}
                      {branch.pincode && ` - ${branch.pincode}`}
                    </p>
                  </div>
                )}

                {/* Contact */}
                {(branch.phone || branch.email) && (
                  <div className="space-y-1 mb-3">
                    {branch.phone && (
                      <div className="flex items-center space-x-2 text-sm text-text-secondary">
                        <Phone className="w-4 h-4" />
                        <span>{branch.phone}</span>
                      </div>
                    )}
                    {branch.email && (
                      <div className="flex items-center space-x-2 text-sm text-text-secondary">
                        <Mail className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 break-all">{branch.email}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Invoice Info */}
                {branch.invoice_prefix && (
                  <div className="mb-3 p-2 bg-gray-50 dark:bg-slate-800/40 rounded">
                    <p className="text-xs text-text-muted">Invoice Prefix</p>
                    <p className="text-sm font-medium text-text-primary">
                      {branch.invoice_prefix}-{branch.next_invoice_number}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.push(`/settings/branches/${branch.id}/edit`)}
                    >
                      <Edit className="mr-1.5 h-4 w-4" />
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleToggleActive(branch.id, branch.is_active)}>
                      {branch.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                  {!branch.is_primary && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(branch.id)}
                      disabled={deleting === branch.id}
                      className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                      {deleting === branch.id ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1.5 h-4 w-4" />
                      )}
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SettingsPageShell>
  );
}
