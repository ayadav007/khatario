'use client';

import { useState, useEffect } from 'react';
import { Save, Loader2, Infinity } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface Limit {
  limit_key: string;
  label: string;
  description?: string;
  unit?: string;
  limit_value: number;
  default_value: number;
  sort_order: number;
}

interface LimitsByCategory {
  [category: string]: Limit[];
}

interface PlanLimitsMatrixProps {
  planId: string;
  planName: string;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  sales: 'Sales Limits',
  purchase: 'Purchase Limits',
  hr: 'HR & Employees Limits',
  general: 'General Limits',
  integrations: 'Integrations Limits',
};

const CATEGORY_ORDER = ['sales', 'purchase', 'hr', 'general', 'integrations'];

export function PlanLimitsMatrix({ planId, planName, onClose }: PlanLimitsMatrixProps) {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [limitsByCategory, setLimitsByCategory] = useState<LimitsByCategory>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const [limitValues, setLimitValues] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!admin?.id) return;
    fetchPlanLimits();
  }, [planId, admin?.id]);

  async function fetchPlanLimits() {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/plans/${planId}/limits`, {
        ...platformAdminFetchInit,
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch plan limits');
      }

      const data = await response.json();
      setLimitsByCategory(data.limits || {});

      // Initialize limit values
      const values: Record<string, number> = {};
      (Object.values(data.limits || {}).flat() as Limit[]).forEach((l: Limit) => {
        values[l.limit_key] = l.limit_value;
      });
      setLimitValues(values);
    } catch (error) {
      console.error('Error fetching plan limits:', error);
      toast.error('Failed to load plan limits');
    } finally {
      setLoading(false);
    }
  }

  function updateLimit(limitKey: string, value: number) {
    setLimitValues(prev => ({
      ...prev,
      [limitKey]: value
    }));
    setModified(true);
  }

  async function handleSave() {
    try {
      setSaving(true);
      const response = await fetch(`/api/admin/plans/${planId}/limits`, {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ limits: limitValues }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save limits');
      }

      toast.success('Plan limits updated successfully!');
      setModified(false);
      await fetchPlanLimits(); // Refresh
    } catch (error: any) {
      console.error('Error saving limits:', error);
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function formatLimitValue(value: number, unit?: string): string {
    if (value === -1) return 'Unlimited';
    if (value === 0) return '0 (Disabled)';
    return `${value}${unit ? ` ${unit}` : ''}`;
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading limits...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6">
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Limits: {planName}</h2>
            <p className="text-gray-600 mt-1">Set usage limits for this plan (-1 for unlimited)</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            disabled={saving}
          >
            ×
          </button>
        </div>

        {/* Limits Matrix by Category */}
        <div className="space-y-6 mb-6">
          {CATEGORY_ORDER.map((category) => {
            const limits = limitsByCategory[category];
            if (!limits || limits.length === 0) return null;

            return (
              <div key={category} className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  {CATEGORY_LABELS[category] || category}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {limits.map((limit) => (
                    <div
                      key={limit.limit_key}
                      className="flex items-start justify-between p-3 rounded-lg border border-gray-200 bg-gray-50"
                    >
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center space-x-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">
                            {limit.label}
                          </span>
                          {limit.unit && (
                            <span className="text-xs text-gray-500">({limit.unit})</span>
                          )}
                        </div>
                        {limit.description && (
                          <p className="text-xs text-gray-500">{limit.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1 font-mono">
                          Current: {formatLimitValue(limitValues[limit.limit_key] ?? limit.default_value, limit.unit)}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <input
                          type="number"
                          value={limitValues[limit.limit_key] ?? limit.default_value}
                          onChange={(e) => {
                            const value = e.target.value === '' ? 0 : parseInt(e.target.value);
                            updateLimit(limit.limit_key, isNaN(value) ? 0 : value);
                          }}
                          onBlur={(e) => {
                            if (e.target.value === '') {
                              updateLimit(limit.limit_key, limit.default_value);
                            }
                          }}
                          className="w-24 px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          placeholder="-1"
                          min="-1"
                          disabled={saving}
                        />
                        {limitValues[limit.limit_key] === -1 && (
                          <Infinity className="w-4 h-4 text-green-600" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !modified}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 flex items-center space-x-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>Save Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
