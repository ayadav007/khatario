'use client';

import { useState, useEffect } from 'react';
import { Check, X, Loader2, Save } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface Feature {
  id: string;
  label: string;
  description?: string;
  icon_name?: string;
  route_path?: string;
  is_addon?: boolean;
  enabled: boolean;
  sort_order: number;
}

interface FeaturesByCategory {
  [category: string]: Feature[];
}

interface PlanFeatureMatrixProps {
  planId: string;
  planName: string;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  inventory: 'Inventory & Labels',
  hr: 'HR & Employees',
  reports: 'Reports',
  settings: 'Settings',
  tools: 'Tools',
  integrations: 'Integrations',
  advanced: 'Advanced',
};

const CATEGORY_ORDER = ['sales', 'purchase', 'inventory', 'hr', 'reports', 'settings', 'tools', 'integrations', 'advanced'];

export function PlanFeatureMatrix({ planId, planName, onClose }: PlanFeatureMatrixProps) {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [featuresByCategory, setFeaturesByCategory] = useState<FeaturesByCategory>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modified, setModified] = useState(false);
  const [featureStates, setFeatureStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!admin?.id) return;
    fetchPlanFeatures();
  }, [planId, admin?.id]);

  async function fetchPlanFeatures() {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/plans/${planId}/features`, {
        ...platformAdminFetchInit,
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch plan features');
      }

      const data = await response.json();
      setFeaturesByCategory(data.features || {});

      // Initialize feature states
      const states: Record<string, boolean> = {};
      (Object.values(data.features || {}).flat() as Feature[]).forEach((f: Feature) => {
        states[f.id] = f.enabled;
      });
      setFeatureStates(states);
    } catch (error) {
      console.error('Error fetching plan features:', error);
      toast.error('Failed to load plan features');
    } finally {
      setLoading(false);
    }
  }

  function toggleFeature(featureId: string) {
    setFeatureStates(prev => ({
      ...prev,
      [featureId]: !prev[featureId]
    }));
    setModified(true);
  }

  async function handleSave() {
    try {
      setSaving(true);
      const response = await fetch(`/api/admin/plans/${planId}/features`, {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ features: featureStates }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save features');
      }

      toast.success('Plan features updated successfully!');
      setModified(false);
      await fetchPlanFeatures(); // Refresh
      
      // Dispatch global event to refresh all Feature Registry instances
      // This ensures sidebar and other components update immediately
      if (process.env.NODE_ENV === 'development') {
        console.log('[PlanFeatureMatrix] Dispatching feature-registry-updated event', { planId });
      }
      window.dispatchEvent(new CustomEvent('feature-registry-updated', {
        detail: { planId }
      }));
    } catch (error: any) {
      console.error('Error saving features:', error);
      toast.error(`Failed to save: ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading features...</p>
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
            <h2 className="text-2xl font-bold text-gray-900">Feature Matrix: {planName}</h2>
            <p className="text-gray-600 mt-1">Enable or disable features for this plan</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            disabled={saving}
          >
            ×
          </button>
        </div>

        {/* Feature Matrix by Category */}
        <div className="space-y-6 mb-6">
          {/* Combine known-order categories with any extras from the API so a
              newly-registered category (e.g. 'inventory') doesn't silently
              disappear from the admin UI. */}
          {Array.from(
            new Set([
              ...CATEGORY_ORDER,
              ...Object.keys(featuresByCategory),
            ])
          ).map((category) => {
            const features = featuresByCategory[category];
            if (!features || features.length === 0) return null;

            return (
              <div key={category} className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  {CATEGORY_LABELS[category] || category}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {features.map((feature) => (
                    <label
                      key={feature.id}
                      className={`flex items-start space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                        featureStates[feature.id]
                          ? 'border-green-200 bg-green-50'
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={featureStates[feature.id] || false}
                        onChange={() => toggleFeature(feature.id)}
                        className="mt-1 w-5 h-5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                        disabled={saving}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className={`text-sm font-medium ${
                            featureStates[feature.id] ? 'text-gray-900' : 'text-gray-600'
                          }`}>
                            {feature.label}
                          </span>
                          {feature.is_addon && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                              Addon
                            </span>
                          )}
                        </div>
                        {feature.description && (
                          <p className="text-xs text-gray-500 mt-1">{feature.description}</p>
                        )}
                        {feature.route_path && (
                          <p className="text-xs text-gray-400 mt-1 font-mono">{feature.route_path}</p>
                        )}
                      </div>
                      {featureStates[feature.id] ? (
                        <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                      ) : (
                        <X className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      )}
                    </label>
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
