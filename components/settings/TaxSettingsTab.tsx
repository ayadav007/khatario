'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Save, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export const TaxSettingsTab: React.FC = () => {
  const { business } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    default_tax_rate: '18',
    currency: 'INR',
    invoice_prefix: 'INV',
    next_invoice_number: '1'
  });

  useEffect(() => {
    if (business) {
      setFormData({
        default_tax_rate: business.default_tax_rate?.toString() || '18',
        currency: business.currency || 'INR',
        invoice_prefix: business.invoice_prefix || 'INV',
        next_invoice_number: business.next_invoice_number?.toString() || '1'
      });
    }
  }, [business]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/business/${business.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_tax_rate: parseFloat(formData.default_tax_rate),
          currency: formData.currency,
          invoice_prefix: formData.invoice_prefix,
          next_invoice_number: parseInt(formData.next_invoice_number)
        }),
      });

      if (res.ok) {
        toast.success('Tax settings updated successfully!');
        window.location.reload();
      } else {
        const data = await res.json();
        toast.error(`Failed to update settings: ${data.error}`);
      }
    } catch (error) {
      console.error('Error updating tax settings:', error);
      toast.error('Failed to update tax settings');
    } finally {
      setSaving(false);
    }
  };

  const gstRegistered = business?.gstin && business.gstin.length === 15;

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
        {/* GST Registration Status */}
        <Card padding="lg">
          <h3 className="text-lg font-semibold text-text-primary mb-4">GST Registration Status</h3>
          <div className="flex items-center gap-3">
            {gstRegistered ? (
              <>
                <CheckCircle className="w-6 h-6 text-green-600" />
                <div>
                  <p className="font-medium text-text-primary">GST Registered</p>
                  <p className="text-sm text-text-secondary">GSTIN: {business?.gstin}</p>
                </div>
              </>
            ) : (
              <>
                <XCircle className="w-6 h-6 text-text-muted" />
                <div>
                  <p className="font-medium text-text-primary">Not GST Registered</p>
                  <p className="text-sm text-text-secondary">
                    Add your GSTIN in Business Profile to enable GST features
                  </p>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* Default Tax Rate */}
        <Card padding="lg">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Default Tax Rate</h3>
          <div className="max-w-lg">
            <Input
              label="GST Rate (%)"
              name="default_tax_rate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={formData.default_tax_rate}
              onChange={handleChange}
              placeholder="18"
            />
            <p className="text-xs text-text-muted mt-2">
              This will be pre-filled when creating invoices. Common rates: 0%, 5%, 12%, 18%, 28%
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
        {/* Invoice Settings */}
        <Card padding="lg">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Invoice Settings</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <Input
                label="Invoice Prefix"
                name="invoice_prefix"
                value={formData.invoice_prefix}
                onChange={handleChange}
                placeholder="INV"
                maxLength={10}
              />
              <p className="text-xs text-text-muted mt-1">
                Example: INV-001, INV-002
              </p>
            </div>

            <div>
              <Input
                label="Next Invoice Number"
                name="next_invoice_number"
                type="number"
                min="1"
                value={formData.next_invoice_number}
                onChange={handleChange}
                placeholder="1"
              />
              <p className="text-xs text-text-muted mt-1">
                Next invoice will be: {formData.invoice_prefix}-{String(formData.next_invoice_number).padStart(3, '0')}
              </p>
            </div>
          </div>
        </Card>

        {/* Currency */}
        <Card padding="lg">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Currency</h3>
          <div className="max-w-lg">
            <label className="block text-sm font-medium text-text-secondary mb-1">Default Currency</label>
            <select
              name="currency"
              value={formData.currency}
              onChange={handleChange}
              className="input w-full"
            >
              <option value="INR">INR - Indian Rupee (₹)</option>
              <option value="USD">USD - US Dollar ($)</option>
              <option value="EUR">EUR - Euro (€)</option>
              <option value="GBP">GBP - British Pound (£)</option>
            </select>
          </div>
        </Card>
      </div>

      {/* GST Information */}
      {gstRegistered && (
        <Card padding="lg" className="bg-slate-50 dark:bg-primary-900/35 border-primary-200 dark:border-primary-800">
          <h3 className="text-lg font-semibold text-text-primary mb-3">GST Compliance</h3>
          <div className="space-y-2 text-sm text-text-secondary">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <p>Automatic CGST/SGST/IGST calculation based on state</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <p>GST-compliant invoice templates available</p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-600 mt-0.5" />
              <p>GSTR-1 and GSTR-2 export capabilities</p>
            </div>
          </div>
        </Card>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          <Save className="w-4 h-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
};

