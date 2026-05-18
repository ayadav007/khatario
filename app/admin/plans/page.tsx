'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit2, Eye, Package, Check, Grid3x3, BarChart3 } from 'lucide-react';
import { PlanFeatureMatrix } from '@/components/admin/PlanFeatureMatrix';
import { PlanLimitsMatrix } from '@/components/admin/PlanLimitsMatrix';
import { useToastContext } from '@/contexts/ToastContext';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface SubscriptionPlan {
  id: string;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  features: {
    limits: {
      max_invoices_per_month: number;
      max_customers: number;
      max_items: number;
      max_users: number;
      max_whatsapp_per_day: number;
      max_employees: number;
    };
    features: Record<string, boolean>;
  };
  is_active: boolean;
  sort_order: number;
}

export default function PlansManagement() {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [showFeatureMatrix, setShowFeatureMatrix] = useState(false);
  const [featureMatrixPlan, setFeatureMatrixPlan] = useState<{ id: string; name: string } | null>(null);
  const [showLimitsMatrix, setShowLimitsMatrix] = useState(false);
  const [limitsMatrixPlan, setLimitsMatrixPlan] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    fetchPlans();
  }, []);

  async function fetchPlans() {
    try {
      const response = await fetch('/api/admin/subscriptions/plans', { ...platformAdminFetchInit });
      const data = await response.json();
      setPlans(data.plans || []);
    } catch (error) {
      console.error('Error fetching plans:', error);
    } finally {
      setLoading(false);
    }
  }

  function viewPlanDetails(plan: SubscriptionPlan) {
    setSelectedPlan(plan);
    setShowDetails(true);
  }

  function editPlan(plan: SubscriptionPlan) {
    setEditingPlan(plan);
    setShowEditModal(true);
  }

  function createNewPlan() {
    // Create empty plan template
    const newPlan: SubscriptionPlan = {
      id: '',
      name: '',
      display_name: '',
      description: '',
      price_monthly: 0,
      price_yearly: 0,
      currency: 'INR',
      features: {
        limits: {
          max_invoices_per_month: 0,
          max_customers: 0,
          max_items: 0,
          max_users: 1,
          max_whatsapp_per_day: 0,
          max_employees: 0
        },
        features: {}
      },
      is_active: true,
      sort_order: 0
    };
    setEditingPlan(newPlan);
    setShowEditModal(true);
  }

  async function savePlan(planData: SubscriptionPlan) {
    try {
      const response = await fetch('/api/admin/subscriptions/plans', {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(planData),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(`Error saving plan: ${error.error || 'Unknown error'}`);
        return;
      }

      // Refresh plans list
      await fetchPlans();
      setShowEditModal(false);
      setEditingPlan(null);
      toast.success('Plan saved successfully!');
    } catch (error) {
      console.error('Error saving plan:', error);
      toast.error('Failed to save plan. Please try again.');
    }
  }

  // Refresh plans after feature/limit changes
  function handleFeatureMatrixClose() {
    setShowFeatureMatrix(false);
    setFeatureMatrixPlan(null);
    fetchPlans(); // Refresh to show updated features
  }

  function handleLimitsMatrixClose() {
    setShowLimitsMatrix(false);
    setLimitsMatrixPlan(null);
    fetchPlans(); // Refresh to show updated limits
  }

  const getPlanColor = (planId: string) => {
    const colors: Record<string, string> = {
      free: 'bg-gray-100 text-gray-800 border-gray-300',
      professional: 'bg-slate-100 text-primary-800 border-primary-300',
      business: 'bg-purple-100 text-purple-800 border-purple-300',
      enterprise: 'bg-orange-100 text-orange-800 border-orange-300',
    };
    return colors[planId] || 'bg-gray-100 text-gray-800';
  };

  const getFeaturesList = (features: Record<string, boolean>) => {
    return Object.entries(features)
      .filter(([_, enabled]) => enabled)
      .map(([key, _]) => key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
      .slice(0, 8); // Show first 8 features
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-300 rounded w-1/4"></div>
          <div className="grid grid-cols-2 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-64 bg-gray-300 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Subscription Plans</h1>
          <p className="text-gray-600 mt-2">Manage pricing and features for all subscription tiers</p>
        </div>
        <button
          onClick={createNewPlan}
          className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
        >
          <Plus className="w-5 h-5" />
          <span>Create Plan</span>
        </button>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`bg-white rounded-xl shadow-sm border-2 ${
              plan.id === 'professional' ? 'border-primary-500' : 'border-gray-200'
            } p-6 hover:shadow-lg transition`}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center space-x-2 mb-2">
                  <Package className="w-5 h-5 text-gray-600" />
                  <h3 className="text-xl font-bold text-gray-900">{plan.display_name}</h3>
                </div>
                <p className="text-sm text-gray-600">{plan.description}</p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getPlanColor(plan.id)}`}>
                {plan.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            {/* Pricing */}
            <div className="mb-4 pb-4 border-b border-gray-200">
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-bold text-gray-900">₹{plan.price_monthly}</span>
                <span className="text-gray-600">/month</span>
              </div>
              {plan.price_yearly > 0 && (
                <p className="text-sm text-green-600 mt-1">
                  ₹{plan.price_yearly}/year (Save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}%)
                </p>
              )}
            </div>

            {/* Limits */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Usage Limits</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-600">Invoices:</span>{' '}
                  <span className="font-semibold">
                    {plan.features.limits.max_invoices_per_month === -1
                      ? 'Unlimited'
                      : plan.features.limits.max_invoices_per_month}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Customers:</span>{' '}
                  <span className="font-semibold">
                    {plan.features.limits.max_customers === -1 ? 'Unlimited' : plan.features.limits.max_customers}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Users:</span>{' '}
                  <span className="font-semibold">
                    {plan.features.limits.max_users === -1 ? 'Unlimited' : plan.features.limits.max_users}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">Employees:</span>{' '}
                  <span className="font-semibold">
                    {plan.features.limits.max_employees === -1 ? 'Unlimited' : plan.features.limits.max_employees}
                  </span>
                </div>
                <div>
                  <span className="text-gray-600">WhatsApp:</span>{' '}
                  <span className="font-semibold">
                    {plan.features.limits.max_whatsapp_per_day === -1
                      ? 'Unlimited'
                      : plan.features.limits.max_whatsapp_per_day === 0
                      ? 'None'
                      : `${plan.features.limits.max_whatsapp_per_day}/day`}
                  </span>
                </div>
              </div>
            </div>

            {/* Key Features */}
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Key Features</h4>
              <ul className="space-y-1">
                {getFeaturesList(plan.features?.features || {}).map((feature, idx) => (
                  <li key={idx} className="flex items-start text-xs text-gray-600">
                    <Check className="w-3 h-3 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div className="flex flex-col space-y-2 pt-4 border-t border-gray-200">
              <div className="flex space-x-2">
                <button
                  onClick={() => viewPlanDetails(plan)}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                >
                  <Eye className="w-4 h-4" />
                  <span className="text-sm font-medium">View Details</span>
                </button>
                <button
                  onClick={() => editPlan(plan)}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-slate-100 text-primary-700 rounded-lg hover:bg-primary-200 transition"
                >
                  <Edit2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Edit Plan</span>
                </button>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={() => {
                    setFeatureMatrixPlan({ id: plan.id, name: plan.display_name });
                    setShowFeatureMatrix(true);
                  }}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 transition"
                >
                  <Grid3x3 className="w-4 h-4" />
                  <span className="text-sm font-medium">Features</span>
                </button>
                <button
                  onClick={() => {
                    setLimitsMatrixPlan({ id: plan.id, name: plan.display_name });
                    setShowLimitsMatrix(true);
                  }}
                  className="flex-1 flex items-center justify-center space-x-2 px-4 py-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition"
                >
                  <BarChart3 className="w-4 h-4" />
                  <span className="text-sm font-medium">Limits</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Details Modal */}
      {showDetails && selectedPlan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">{selectedPlan.display_name}</h2>
                <p className="text-gray-600 mt-1">{selectedPlan.description}</p>
              </div>
              <button
                onClick={() => setShowDetails(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {/* Full Feature List */}
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">All Features</h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(selectedPlan.features.features).map(([key, enabled]) => (
                    <div
                      key={key}
                      className={`flex items-center space-x-2 text-sm ${
                        enabled ? 'text-gray-700' : 'text-gray-400 line-through'
                      }`}
                    >
                      <Check className={`w-4 h-4 ${enabled ? 'text-green-500' : 'text-gray-300'}`} />
                      <span>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Pricing Details</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Monthly Price:</span>
                    <span className="font-semibold">₹{selectedPlan.price_monthly}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Yearly Price:</span>
                    <span className="font-semibold">₹{selectedPlan.price_yearly}</span>
                  </div>
                  {selectedPlan.price_yearly > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Yearly Savings:</span>
                      <span className="font-semibold">
                        {Math.round((1 - selectedPlan.price_yearly / (selectedPlan.price_monthly * 12)) * 100)}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Create Plan Modal */}
      {showEditModal && editingPlan && (
        <EditPlanModal
          plan={editingPlan}
          onClose={() => {
            setShowEditModal(false);
            setEditingPlan(null);
          }}
          onSave={savePlan}
        />
      )}

      {/* Feature Matrix Modal */}
      {showFeatureMatrix && featureMatrixPlan && (
        <PlanFeatureMatrix
          planId={featureMatrixPlan.id}
          planName={featureMatrixPlan.name}
          onClose={handleFeatureMatrixClose}
        />
      )}

      {/* Limits Matrix Modal */}
      {showLimitsMatrix && limitsMatrixPlan && (
        <PlanLimitsMatrix
          planId={limitsMatrixPlan.id}
          planName={limitsMatrixPlan.name}
          onClose={handleLimitsMatrixClose}
        />
      )}
    </div>
  );
}

// Edit Plan Modal Component
function EditPlanModal({
  plan,
  onClose,
  onSave,
}: {
  plan: SubscriptionPlan;
  onClose: () => void;
  onSave: (plan: SubscriptionPlan) => void;
}) {
  const [formData, setFormData] = useState<SubscriptionPlan>(plan);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(formData);
    } finally {
      setSaving(false);
    }
  };

  const updateField = (field: keyof SubscriptionPlan, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const updateLimit = (limitKey: keyof SubscriptionPlan['features']['limits'], value: number) => {
    setFormData((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        limits: {
          ...prev.features.limits,
          [limitKey]: value,
        },
      },
    }));
  };

  const toggleFeature = (featureKey: string) => {
    setFormData((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        features: {
          ...prev.features.features,
          [featureKey]: !prev.features.features[featureKey],
        },
      },
    }));
  };

  // Common feature keys
  const featureKeys = [
    'customer_management',
    'item_management',
    'invoice_creation',
    'payment_tracking',
    'stock_tracking',
    'dashboard_analytics',
    'template_basic',
    'template_all',
    'template_thermal',
    'template_customization',
    'pdf_generation',
    'purchase_management',
    'expense_tracking',
    'supplier_management',
    'multi_user',
    'multi_branch',
    'reports_basic',
    'reports_gst',
    'reports_advanced',
    'reports_analytics',
    'alert_low_stock',
    'alert_credit_limit',
    'whatsapp_manual',
    'whatsapp_auto_reminders',
    'email_invoicing',
    'payment_gateway',
    'api_access',
    'recurring_invoices',
    'estimates_quotations',
    'credit_notes',
    'ledger_accounting',
    'backup_restore',
    'online_store',
    'barcode_scanning',
    'multi_currency',
    'custom_branding',
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            {plan.id ? 'Edit Plan' : 'Create New Plan'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            disabled={saving}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Plan ID *
              </label>
              <input
                type="text"
                value={formData.id}
                onChange={(e) => updateField('id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
                disabled={!!plan.id} // Don't allow editing ID for existing plans
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Display Name *
              </label>
              <input
                type="text"
                value={formData.display_name}
                onChange={(e) => updateField('display_name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => updateField('description', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                rows={2}
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Monthly Price *
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.price_monthly}
                onChange={(e) => updateField('price_monthly', parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Yearly Price
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.price_yearly}
                onChange={(e) => updateField('price_yearly', parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Currency
              </label>
              <input
                type="text"
                value={formData.currency}
                onChange={(e) => updateField('currency', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                maxLength={3}
              />
            </div>
          </div>

          {/* Limits */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Usage Limits</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Invoices/Month (-1 for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.features.limits.max_invoices_per_month}
                  onChange={(e) => updateLimit('max_invoices_per_month', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Customers (-1 for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.features.limits.max_customers}
                  onChange={(e) => updateLimit('max_customers', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Items (-1 for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.features.limits.max_items}
                  onChange={(e) => updateLimit('max_items', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Users (-1 for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.features.limits.max_users}
                  onChange={(e) => updateLimit('max_users', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Employees (-1 for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.features.limits.max_employees}
                  onChange={(e) => updateLimit('max_employees', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max WhatsApp/Day (-1 for unlimited)
                </label>
                <input
                  type="number"
                  value={formData.features.limits.max_whatsapp_per_day}
                  onChange={(e) => updateLimit('max_whatsapp_per_day', parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          </div>

          {/* Features */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Features</h3>
            <div className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-4">
              {featureKeys.map((key) => (
                <label
                  key={key}
                  className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                >
                  <input
                    type="checkbox"
                    checked={formData.features.features[key] || false}
                    onChange={() => toggleFeature(key)}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">
                    {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Status & Sort */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => updateField('is_active', e.target.checked)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                />
                <span className="text-sm font-medium text-gray-700">Active</span>
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sort Order
              </label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) => updateField('sort_order', parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

