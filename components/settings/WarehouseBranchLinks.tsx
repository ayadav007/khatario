'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, Building2, Check, X, Star } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'react-hot-toast';

interface BranchLink {
  id: string;
  name: string;
  branch_code: string | null;
  is_active: boolean;
  is_linked: boolean;
  is_primary: boolean;
}

interface WarehouseBranchLinksProps {
  warehouseId: string;
  onClose?: () => void;
}

export function WarehouseBranchLinks({ warehouseId, onClose }: WarehouseBranchLinksProps) {
  const { business, user } = useAuth();
  const [branches, setBranches] = useState<BranchLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (business?.id && user?.id && warehouseId) {
      fetchBranchLinks();
    }
  }, [business?.id, user?.id, warehouseId]);

  const fetchBranchLinks = async () => {
    if (!business?.id || !user?.id || !warehouseId) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/warehouses/${warehouseId}/branches?business_id=${business.id}&user_id=${user.id}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch branch links');
      }

      const data = await response.json();
      setBranches(data.branches || []);
    } catch (error: any) {
      console.error('Error fetching branch links:', error);
      toast.error('Failed to load branch links');
    } finally {
      setLoading(false);
    }
  };

  const toggleBranchLink = (branchId: string) => {
    setBranches((prev) => {
      const updated = prev.map((br) => {
        if (br.id === branchId) {
          const newLinkedState = !br.is_linked;
          return {
            ...br,
            is_linked: newLinkedState,
            // If unlinking, remove primary flag
            is_primary: newLinkedState ? br.is_primary : false,
          };
        }
        return br;
      });

      // If linking a branch and it's the first linked one, make it primary
      const linkedCount = updated.filter((b) => b.is_linked).length;
      const wasLinking = !prev.find((b) => b.id === branchId)?.is_linked;
      if (wasLinking && linkedCount === 1) {
        return updated.map((br) => ({
          ...br,
          is_primary: br.id === branchId,
        }));
      }

      // If unlinking the primary branch and there are other linked branches, make the first one primary
      const wasPrimary = prev.find((b) => b.id === branchId)?.is_primary;
      if (wasPrimary && !wasLinking && linkedCount > 0) {
        const firstLinked = updated.find((b) => b.is_linked && b.id !== branchId);
        if (firstLinked) {
          return updated.map((br) => ({
            ...br,
            is_primary: br.id === firstLinked.id,
          }));
        }
      }

      return updated;
    });
  };

  const setPrimaryBranch = (branchId: string) => {
    setBranches((prev) =>
      prev.map((br) => ({
        ...br,
        is_primary: br.id === branchId && br.is_linked,
      }))
    );
  };

  const handleSave = async () => {
    if (!business?.id || !user?.id) return;

    setSaving(true);
    try {
      const linkedBranchIds = branches.filter((br) => br.is_linked).map((br) => br.id);
      const primaryBranchId = branches.find((br) => br.is_primary && br.is_linked)?.id || null;

      const response = await fetch(`/api/warehouses/${warehouseId}/branches`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user.id,
          branch_ids: linkedBranchIds,
          primary_branch_id: primaryBranchId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update branch links');
      }

      toast.success('Branch links updated successfully');
      if (onClose) {
        onClose();
      }
    } catch (error: any) {
      console.error('Error updating branch links:', error);
      toast.error(error.message || 'Failed to update branch links');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  const linkedBranches = branches.filter((br) => br.is_linked);
  const unlinkedBranches = branches.filter((br) => !br.is_linked);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Linked Branches</h3>
          <p className="text-sm text-text-secondary mt-1">
            Link this warehouse to branches. Users with branch access will automatically get warehouse access (if auto-assign is enabled).
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {branches.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <Building2 className="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <p>No branches found. Create branches first.</p>
        </div>
      ) : (
        <>
          {/* Linked Branches */}
          {linkedBranches.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-text-secondary">Linked Branches</h4>
              {linkedBranches.map((br) => (
                <Card key={br.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <input
                        type="checkbox"
                        checked={br.is_linked}
                        onChange={() => toggleBranchLink(br.id)}
                        className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-text-primary">{br.name}</h4>
                          {br.branch_code && (
                            <span className="text-xs text-text-muted">({br.branch_code})</span>
                          )}
                          {br.is_primary && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-200 rounded text-xs font-medium">
                              <Star className="w-3 h-3 fill-current" />
                              Primary
                            </span>
                          )}
                          {!br.is_active && (
                            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded">
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      {br.is_linked && linkedBranches.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPrimaryBranch(br.id)}
                          disabled={br.is_primary}
                          title={br.is_primary ? 'Already primary' : 'Set as primary branch'}
                        >
                          <Star className={`w-4 h-4 ${br.is_primary ? 'fill-current text-yellow-600' : ''}`} />
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Unlinked Branches */}
          {unlinkedBranches.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-text-secondary">Available Branches</h4>
              {unlinkedBranches.map((br) => (
                <Card key={br.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <input
                        type="checkbox"
                        checked={br.is_linked}
                        onChange={() => toggleBranchLink(br.id)}
                        disabled={!br.is_active}
                        className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500 disabled:opacity-50"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium text-text-primary">{br.name}</h4>
                          {br.branch_code && (
                            <span className="text-xs text-text-muted">({br.branch_code})</span>
                          )}
                          {!br.is_active && (
                            <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded">
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex justify-end gap-2 pt-4 border-t border-border">
        {onClose && (
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            <>
              <Check className="w-4 h-4 mr-2" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
