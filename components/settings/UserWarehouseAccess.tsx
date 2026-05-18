'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, Warehouse, Check, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'react-hot-toast';

interface WarehouseAccess {
  id: string;
  name: string;
  warehouse_code: string | null;
  branch_id: string | null;
  branch_name: string | null;
  is_active: boolean;
  access: {
    can_view: boolean;
    can_edit: boolean;
    can_create_transactions: boolean;
  } | null;
}

interface UserWarehouseAccessProps {
  userId: string;
  onClose?: () => void;
}

export function UserWarehouseAccess({ userId, onClose }: UserWarehouseAccessProps) {
  const { business, user } = useAuth();
  const [warehouses, setWarehouses] = useState<WarehouseAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (business?.id && user?.id && userId) {
      fetchWarehouseAccess();
    }
  }, [business?.id, user?.id, userId]);

  const fetchWarehouseAccess = async () => {
    if (!business?.id || !user?.id || !userId) return;

    setLoading(true);
    try {
      const response = await fetch(
        `/api/settings/users/${userId}/warehouses?business_id=${business.id}&user_id=${user.id}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch warehouse access');
      }

      const data = await response.json();
      setWarehouses(data.warehouses || []);
    } catch (error: any) {
      console.error('Error fetching warehouse access:', error);
      toast.error('Failed to load warehouse access');
    } finally {
      setLoading(false);
    }
  };

  const updateWarehouseAccess = async (warehouseId: string, field: string, value: boolean) => {
    if (!business?.id || !user?.id) return;

    setWarehouses((prev) =>
      prev.map((wh) => {
        if (wh.id === warehouseId) {
          return {
            ...wh,
            access: wh.access
              ? { ...wh.access, [field]: value }
              : { can_view: false, can_edit: false, can_create_transactions: false, [field]: value },
          };
        }
        return wh;
      })
    );
  };

  const handleSave = async () => {
    if (!business?.id || !user?.id) return;

    setSaving(true);
    try {
      const warehousesToSave = warehouses
        .filter((wh) => wh.access)
        .map((wh) => ({
          warehouse_id: wh.id,
          can_view: wh.access!.can_view,
          can_edit: wh.access!.can_edit,
          can_create_transactions: wh.access!.can_create_transactions,
        }));

      const response = await fetch(`/api/settings/users/${userId}/warehouses`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user.id,
          warehouses: warehousesToSave,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update warehouse access');
      }

      toast.success('Warehouse access updated successfully');
      if (onClose) {
        onClose();
      }
    } catch (error: any) {
      console.error('Error updating warehouse access:', error);
      toast.error(error.message || 'Failed to update warehouse access');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Warehouse Access</h3>
          <p className="text-sm text-text-secondary mt-1">
            Assign specific warehouses and permissions to this user
          </p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      {warehouses.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <Warehouse className="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <p>No warehouses found. Create warehouses first.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {warehouses.map((wh) => (
            <Card key={wh.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-text-primary">{wh.name}</h4>
                    {wh.warehouse_code && (
                      <span className="text-xs text-text-muted">({wh.warehouse_code})</span>
                    )}
                    {!wh.is_active && (
                      <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  {wh.branch_name && (
                    <p className="text-xs text-text-muted mt-1">Branch: {wh.branch_name}</p>
                  )}
                </div>
                <div className="flex items-center gap-4 ml-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wh.access?.can_view || false}
                      onChange={(e) =>
                        updateWarehouseAccess(wh.id, 'can_view', e.target.checked)
                      }
                      disabled={!wh.is_active}
                      className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500"
                    />
                    <span className="text-sm text-text-secondary">View</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wh.access?.can_edit || false}
                      onChange={(e) =>
                        updateWarehouseAccess(wh.id, 'can_edit', e.target.checked)
                      }
                      disabled={!wh.is_active || !wh.access?.can_view}
                      className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-text-secondary">Edit</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wh.access?.can_create_transactions || false}
                      onChange={(e) =>
                        updateWarehouseAccess(wh.id, 'can_create_transactions', e.target.checked)
                      }
                      disabled={!wh.is_active || !wh.access?.can_view}
                      className="w-4 h-4 text-primary-600 rounded border-border dark:border-slate-500 bg-surface focus:ring-primary-500 disabled:opacity-50"
                    />
                    <span className="text-sm text-text-secondary">Create</span>
                  </label>
                </div>
              </div>
            </Card>
          ))}
        </div>
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
