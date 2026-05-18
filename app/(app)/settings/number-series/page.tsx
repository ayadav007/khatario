'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Link from 'next/link';
import { ChevronRight, Hash, Save, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { DOCUMENT_RULES, DocumentType } from '@/lib/invoice-config';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { useToastContext } from '@/contexts/ToastContext';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface DocumentConfig {
  type: DocumentType;
  label: string;
  prefix: string;
  startingNumber: string; // String to allow leading zeros like "00001"
  currentNumber: number;
  branchNumbers?: Record<string, number>; // Branch-specific current numbers
}

interface BranchConfig {
  id: string;
  name: string;
  invoice_prefix: string | null; // Legacy field, kept for backward compatibility
  next_invoice_number: number;
  is_default: boolean;
}

interface BranchPrefixes {
  [branchId: string]: {
    [documentType: string]: string; // document_type -> prefix
  };
}

function NumberSeriesPage() {
  const { business, user } = useAuth();
  const { success, error } = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [documentConfigs, setDocumentConfigs] = useState<DocumentConfig[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<string[]>([]);
  const [branches, setBranches] = useState<BranchConfig[]>([]);
  const [branchPrefixes, setBranchPrefixes] = useState<BranchPrefixes>({});

  useEffect(() => {
    if (business?.id && user?.id) {
      fetchConfig();
    }
  }, [business?.id, user?.id]);

  // Update prefix display when branch selection changes
  useEffect(() => {
    if (branches.length > 1 && selectedBranches.length === 1) {
      // When only one branch is selected, update prefix to show that branch's prefix for each document type
      const selectedBranchId = selectedBranches[0];
      setDocumentConfigs(prev => prev.map(config => {
        // Use branch's prefix for this document type if set, otherwise use document type default
        const branchPrefix = branchPrefixes[selectedBranchId]?.[config.type];
        const docTypePrefix = DOCUMENT_RULES[config.type as keyof typeof DOCUMENT_RULES]?.prefix || 'INV';
        // Show branch-specific prefix if it exists, otherwise show document type default
        return {
          ...config,
          prefix: branchPrefix || docTypePrefix
        };
      }));
    } else if (branches.length > 1 && (selectedBranches.length === 0 || selectedBranches.length > 1)) {
      // When multiple or no branches selected, reset to document type defaults
      setDocumentConfigs(prev => prev.map(config => ({
        ...config,
        prefix: DOCUMENT_RULES[config.type as keyof typeof DOCUMENT_RULES]?.prefix || 'INV'
      })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranches, branchPrefixes]);

  const fetchConfig = async () => {
    if (!business?.id || !user?.id) return;
    
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/number-series?business_id=${business.id}&user_id=${user.id}`
      );
      if (res.ok) {
        const data = await res.json();
        
        // Set branches first so we can use them in buildBranchNumbers
        const branchesData = data.branches || [];
        setBranches(branchesData);
        // Select all branches by default
        setSelectedBranches(branchesData.map((b: BranchConfig) => b.id) || []);
        
        // Set branch prefixes map
        setBranchPrefixes(data.branchPrefixes || {});

        // Build branch-specific numbers map
        const buildBranchNumbers = (docType: string): Record<string, number> => {
          const branchNums: Record<string, number> = {};
          if (data.branchStats) {
            branchesData.forEach((branch: BranchConfig) => {
              branchNums[branch.id] = data.branchStats?.[branch.id]?.[docType] || 0;
            });
          }
          return branchNums;
        };

        // Determine the prefix to show in the input field
        // If only one branch is selected, show that branch's prefix for this document type (if set), otherwise show document type default
        // If multiple branches selected, show document type default (will apply to all selected)
        const getDisplayPrefix = (docType: string): string => {
          // On initial load, if there's only one branch total, show its prefix for this document type
          if (branchesData.length === 1) {
            const branchId = branchesData[0].id;
            const branchPrefix = data.branchPrefixes?.[branchId]?.[docType];
            if (branchPrefix) {
              return branchPrefix;
            }
          }
          // Multiple branches or no branch prefix - show document type default
          return DOCUMENT_RULES[docType as keyof typeof DOCUMENT_RULES]?.prefix || 'INV';
        };

        const configs: DocumentConfig[] = [
          { 
            type: 'tax_invoice', 
            label: 'Tax Invoice', 
            prefix: getDisplayPrefix('tax_invoice'), 
            startingNumber: String(data.business.next_tax_invoice_number || 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.tax_invoice || 0,
            branchNumbers: buildBranchNumbers('tax_invoice'),
          },
          { 
            type: 'proforma_invoice', 
            label: 'Proforma Invoice', 
            prefix: getDisplayPrefix('proforma_invoice'), 
            startingNumber: String(data.business.next_proforma_invoice_number || 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.proforma_invoice || 0,
            branchNumbers: buildBranchNumbers('proforma_invoice'),
          },
          { 
            type: 'bill_of_supply', 
            label: 'Bill of Supply', 
            prefix: getDisplayPrefix('bill_of_supply'), 
            startingNumber: String(data.business.next_tax_invoice_number || 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.bill_of_supply || 0,
            branchNumbers: buildBranchNumbers('bill_of_supply'),
          },
          { 
            type: 'sales_order', 
            label: 'Sales Order', 
            prefix: getDisplayPrefix('sales_order'), 
            startingNumber: String(data.currentStats?.sales_order ? data.currentStats.sales_order + 1 : 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.sales_order || 0,
            branchNumbers: buildBranchNumbers('sales_order'),
          },
          { 
            type: 'delivery_challan', 
            label: 'Delivery Challan', 
            prefix: getDisplayPrefix('delivery_challan'), 
            startingNumber: String(data.currentStats?.delivery_challan ? data.currentStats.delivery_challan + 1 : 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.delivery_challan || 0,
            branchNumbers: buildBranchNumbers('delivery_challan'),
          },
          { 
            type: 'credit_note', 
            label: 'Credit Note', 
            prefix: getDisplayPrefix('credit_note'), 
            startingNumber: String(data.currentStats?.credit_note ? data.currentStats.credit_note + 1 : 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.credit_note || 0,
            branchNumbers: buildBranchNumbers('credit_note'),
          },
          { 
            type: 'debit_note', 
            label: 'Debit Note', 
            prefix: getDisplayPrefix('debit_note'), 
            startingNumber: String(data.currentStats?.debit_note ? data.currentStats.debit_note + 1 : 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.debit_note || 0,
            branchNumbers: buildBranchNumbers('debit_note'),
          },
          { 
            type: 'purchase_order', 
            label: 'Purchase Order', 
            prefix: getDisplayPrefix('purchase_order'), 
            startingNumber: String(data.currentStats?.purchase_order ? data.currentStats.purchase_order + 1 : 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.purchase_order || 0,
            branchNumbers: buildBranchNumbers('purchase_order'),
          },
          { 
            type: 'work_order', 
            label: 'Work Order', 
            prefix: getDisplayPrefix('work_order'), 
            startingNumber: String(data.currentStats?.work_order ? data.currentStats.work_order + 1 : 1).padStart(5, '0'), 
            currentNumber: data.currentStats?.work_order || 0,
            branchNumbers: buildBranchNumbers('work_order'),
          },
        ];

        setDocumentConfigs(configs);
      } else {
        const errorData = await res.json();
        error(`Failed to load configuration: ${errorData.error}`);
      }
    } catch (err) {
      console.error('Error fetching config:', err);
      error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = (type: DocumentType, field: 'prefix' | 'startingNumber', value: string) => {
    setDocumentConfigs(prev => 
      prev.map(config => 
        config.type === type 
          ? { ...config, [field]: value }
          : config
      )
    );
  };

  const formatPreview = (prefix: string, startingNumber: string): string => {
    if (!prefix && !startingNumber) return '';
    if (!prefix) return startingNumber;
    if (!startingNumber || startingNumber === '0') return prefix;
    return `${prefix}-${startingNumber}`;
  };

  const handleSave = async () => {
    if (!business?.id || !user?.id) return;

    if (selectedBranches.length === 0 && branches.length > 1) {
      error('Please select at least one branch to apply the settings to.');
      return;
    }

    setSaving(true);
    try {
      // Save each document type configuration
      const savePromises = documentConfigs.map(config => {
        // Remove leading zeros for storage, but keep the string format for display
        const startingNum = parseInt(config.startingNumber.replace(/^0+/, '') || '1');
        return fetch('/api/settings/number-series', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: business.id,
            user_id: user.id,
            document_type: config.type,
            prefix: config.prefix,
            starting_number: startingNum,
            branch_ids: branches.length > 1 ? selectedBranches : undefined, // Apply to selected branches if multiple branches exist
          }),
        });
      });

      const results = await Promise.all(savePromises);
      const errors = results.filter(r => !r.ok);
      
      if (errors.length > 0) {
        const errorData = await errors[0].json();
        error(`Some configurations failed to save: ${errorData.error || 'Unknown error'}`);
      } else {
        success('Transaction number series saved successfully');
        fetchConfig(); // Refresh
      }
    } catch (err) {
      console.error('Error saving config:', err);
      error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/settings" className="hover:text-primary-600 transition">Settings</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-muted">Customization</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-primary font-medium">Transaction Number Series</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-orange-100 rounded-xl">
          <Hash className="w-6 h-6 text-orange-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Transaction Number Series</h1>
          <p className="text-sm text-text-secondary">Configure prefixes and starting numbers for all transaction types</p>
        </div>
      </div>

      <Card padding="lg">
        {/* Branch Selection (if multiple branches) */}
        {branches.length > 1 && (
          <div className="mb-6 pb-6 border-b border-border">
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Branch
            </label>
            <div className="flex flex-wrap gap-2">
              {branches.map((branch) => (
                <label
                  key={branch.id}
                  className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg cursor-pointer bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80 transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedBranches.includes(branch.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedBranches([...selectedBranches, branch.id]);
                      } else {
                        setSelectedBranches(selectedBranches.filter(id => id !== branch.id));
                      }
                    }}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                  <Building2 className="w-4 h-4 text-text-muted" />
                  <span className="text-sm text-text-secondary">{branch.name}</span>
                  {branch.is_default && (
                    <span className="text-xs text-primary-600 font-medium">(Default)</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Transaction Series Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-border">
                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary uppercase">Module</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary uppercase">Prefix</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary uppercase">Starting Number</th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary uppercase">Preview</th>
                {branches.length > 1 && (
                  <th className="text-left py-3 px-4 text-sm font-semibold text-text-secondary uppercase">Branch Status</th>
                )}
              </tr>
            </thead>
            <tbody>
              {documentConfigs.map((config) => (
                <tr key={config.type} className="border-b border-border hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 transition-colors">
                  <td className="py-3 px-4 text-sm text-text-primary font-medium">
                    {config.label}
                  </td>
                  <td className="py-3 px-4">
                    <Input
                      value={config.prefix}
                      onChange={(e) => updateConfig(config.type, 'prefix', e.target.value.toUpperCase())}
                      className="w-32 uppercase"
                      placeholder="INV"
                      maxLength={10}
                    />
                  </td>
                  <td className="py-3 px-4">
                    <Input
                      value={config.startingNumber}
                      onChange={(e) => {
                        // Allow only digits, preserve leading zeros
                        const value = e.target.value.replace(/\D/g, '');
                        if (value === '') {
                          updateConfig(config.type, 'startingNumber', '1');
                        } else {
                          updateConfig(config.type, 'startingNumber', value);
                        }
                      }}
                      className="w-32 font-mono"
                      placeholder="00001"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <span className="text-sm text-text-secondary font-mono">
                      {formatPreview(config.prefix, config.startingNumber) || '-'}
                    </span>
                  </td>
                  {branches.length > 1 && (
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        {branches.map((branch) => {
                          const branchNum = config.branchNumbers?.[branch.id] || 0;
                          const nextNum = branch.next_invoice_number || 1;
                          // Use branch-specific prefix for this document type if it exists, otherwise use document type default prefix
                          const branchPrefix = branchPrefixes[branch.id]?.[config.type] || DOCUMENT_RULES[config.type as keyof typeof DOCUMENT_RULES]?.prefix || 'INV';
                          return (
                            <div key={branch.id} className="text-xs text-text-secondary">
                              <span className="font-medium">{branch.name}:</span>{' '}
                              {branchNum > 0 ? (
                                <span className="font-mono">Current: {formatPreview(branchPrefix, String(branchNum).padStart(5, '0'))}</span>
                              ) : (
                                <span className="text-text-muted">No records</span>
                              )}
                              {' | '}
                              <span className="font-mono text-primary-600">Next: {formatPreview(branchPrefix, String(nextNum).padStart(5, '0'))}</span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-end gap-3 mt-6 pt-6 border-t border-border">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default withPageAuth('settings', 'read', NumberSeriesPage);
