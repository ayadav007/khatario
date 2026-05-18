'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, Building2, Phone, Mail, CheckCircle, Edit, Trash2, XCircle, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { useRouter } from 'next/navigation';
import { useFeatureRegistry } from '@/hooks/useFeatureRegistry';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

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
      
        <div className={`${SETTINGS_CONTENT_WIDTH} py-8 flex justify-center`}>
          <div className="max-w-2xl w-full bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border p-8 text-center">
            <Building2 className="w-16 h-16 text-text-muted mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-text-primary mb-2">
              Multi-Branch Feature is Locked
            </h2>
            <p className="text-text-secondary mb-6">
              Upgrade to Enterprise plan to unlock multi-branch support, branch-wise accounting, and consolidated reporting.
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
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Branches</h1>
            <p className="text-text-secondary text-sm mt-1">Manage branch offices and accounting units</p>
          </div>
          <button
            onClick={() => router.push('/settings/branches/new')}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>Add Branch</span>
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <Building2 className="w-5 h-5 text-primary-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-primary-900">About Branches</p>
              <p className="text-sm text-primary-700 mt-1">
                Branches are accounting and compliance units. Each branch can have its own GSTIN, invoice numbering, and financial statements. 
                Warehouses are physical storage locations that can be linked to branches.
              </p>
            </div>
          </div>
        </div>

        {/* Branches Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {branches.length === 0 ? (
            <div className="col-span-full p-12 text-center bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border">
              <Building2 className="w-12 h-12 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-2">No branches found</p>
              <p className="text-sm text-text-muted mb-4">Create your first branch to get started</p>
              <button
                onClick={() => router.push('/settings/branches/new')}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Add Your First Branch
              </button>
            </div>
          ) : (
            branches.map((branch) => (
              <div
                key={branch.id}
                className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border p-6 hover:shadow-md transition"
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="bg-slate-100 p-2 rounded-lg">
                      <Building2 className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-text-primary">{branch.name}</h3>
                      {branch.branch_code && (
                        <p className="text-xs text-text-muted">{branch.branch_code}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {branch.is_primary && (
                      <div className="flex items-center space-x-1 px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                        <CheckCircle className="w-3 h-3" />
                        <span>Primary</span>
                      </div>
                    )}
                    {!branch.is_active && (
                      <div className="flex items-center space-x-1 px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                        <XCircle className="w-3 h-3" />
                        <span>Inactive</span>
                      </div>
                    )}
                  </div>
                </div>

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
                        <Mail className="w-4 h-4" />
                        <span>{branch.email}</span>
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
                <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => router.push(`/settings/branches/${branch.id}/edit`)}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center space-x-1"
                    >
                      <Edit className="w-4 h-4" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleToggleActive(branch.id, branch.is_active)}
                      className="text-sm text-text-secondary hover:text-text-secondary"
                    >
                      {branch.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                  {!branch.is_primary && (
                    <button
                      onClick={() => handleDelete(branch.id)}
                      disabled={deleting === branch.id}
                      className="text-sm text-red-600 hover:text-red-700 disabled:opacity-50 flex items-center space-x-1"
                    >
                      {deleting === branch.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    
  );
}
