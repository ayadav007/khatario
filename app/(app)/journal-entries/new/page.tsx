'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Plus, X, AlertCircle } from 'lucide-react';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Account } from '@/types/database';
import Link from 'next/link';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';

interface JournalLine {
  id: string;
  account_id: string;
  account_code?: string;
  account_name?: string;
  debit: string;
  credit: string;
  narration: string;
}

export default function NewJournalEntryPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [loading, setLoading] = useState(false);
  
  // Check authorization before rendering form
  const { allowed: canCreate, loading: authLoading, reason } = useAuthorizationGuard({
    resource: 'journal',
    action: 'create',
    skipCheck: !user?.id || !business?.id
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [searchAccount, setSearchAccount] = useState<string[]>([]);
  const [showAccountDropdown, setShowAccountDropdown] = useState<boolean[]>([]);

  const [formData, setFormData] = useState({
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    reference_number: '',
    narration: '',
    tags: [] as string[],
    is_reversing: false,
    reverses_entry_id: '',
    reversal_date: '',
    template_id: '',
    branch_id: '', // CRITICAL: Branch ID for branch-wise accounting
    backdate_reason: '', // Reason for backdating (if entry is backdated)
  });
  const [branches, setBranches] = useState<Array<{ id: string; name: string; is_primary: boolean }>>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [availableEntries, setAvailableEntries] = useState<any[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [lines, setLines] = useState<JournalLine[]>([
    { id: '1', account_id: '', debit: '', credit: '', narration: '' },
    { id: '2', account_id: '', debit: '', credit: '', narration: '' },
  ]);

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (business?.id) {
      fetchAccounts();
      fetchTemplates();
      fetchBranches();
      if (formData.is_reversing) {
        fetchAvailableEntries();
      }
    }
  }, [business?.id, formData.is_reversing]);

  const fetchBranches = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/branches?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setBranches(data.branches || []);
        // Auto-select primary branch if available
        const primaryBranch = data.branches?.find((b: any) => b.is_primary);
        if (primaryBranch && !formData.branch_id) {
          setFormData(prev => ({ ...prev, branch_id: primaryBranch.id }));
        }
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  };

  const fetchTemplates = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/journal-entries/templates?business_id=${business.id}&is_active=true`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
    }
  };

  const fetchAvailableEntries = async () => {
    if (!business?.id) return;
    try {
      const res = await fetch(`/api/journal-entries?business_id=${business.id}&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setAvailableEntries(data.entries || []);
      }
    } catch (error) {
      console.error('Error fetching entries:', error);
    }
  };

  const handleTemplateSelect = async (templateId: string) => {
    if (!templateId) return;
    try {
      const res = await fetch(`/api/journal-entries/templates/${templateId}?business_id=${business?.id}`);
      if (res.ok) {
        const data = await res.json();
        const template = data.template;
        if (template.lines && Array.isArray(template.lines)) {
          // Calculate entry date with offset
          const entryDate = new Date();
          entryDate.setDate(entryDate.getDate() + (template.entry_date_offset || 0));
          setFormData((prev) => ({
            ...prev,
            entry_date: format(entryDate, 'yyyy-MM-dd'),
            template_id: templateId,
          }));

          // Populate lines from template
          const templateLines: JournalLine[] = template.lines.map((line: any, idx: number) => ({
            id: (idx + 1).toString(),
            account_id: line.account_id,
            debit: line.debit?.toString() || '',
            credit: line.credit?.toString() || '',
            narration: line.narration || '',
          }));
          setLines(templateLines);
          setSearchAccount(templateLines.map(() => ''));
          setShowAccountDropdown(templateLines.map(() => false));
        }
      }
    } catch (error) {
      console.error('Error loading template:', error);
    }
  };

  const handleReversingEntrySelect = async (entryId: string) => {
    if (!entryId || !business?.id) return;
    try {
      const res = await fetch(`/api/journal-entries/${entryId}?business_id=${business.id}`);
      if (res.ok) {
        const data = await res.json();
        const entry = data.entry;
        setFormData((prev) => ({
          ...prev,
          entry_date: entry.entry_date,
          reverses_entry_id: entryId,
        }));
        // Lines will be auto-populated when submitting (handled in API)
      }
    } catch (error) {
      console.error('Error loading entry:', error);
    }
  };

  const addTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()],
      }));
      setTagInput('');
    }
  };

  const removeTag = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }));
  };

  const fetchAccounts = async () => {
    if (!business?.id) return;

    try {
      const res = await fetch(`/api/accounts?business_id=${business.id}&is_active=true&user_id=${user?.id}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const addLine = () => {
    setLines([...lines, { id: Date.now().toString(), account_id: '', debit: '', credit: '', narration: '' }]);
    setSearchAccount([...searchAccount, '']);
    setShowAccountDropdown([...showAccountDropdown, false]);
  };

  const removeLine = (index: number) => {
    if (lines.length <= 2) {
      toast.error('Journal entry must have at least 2 lines');
      return;
    }
    const newLines = lines.filter((_, i) => i !== index);
    setLines(newLines);
    const newSearch = searchAccount.filter((_, i) => i !== index);
    setSearchAccount(newSearch);
    const newDropdown = showAccountDropdown.filter((_, i) => i !== index);
    setShowAccountDropdown(newDropdown);
  };

  const updateLine = (index: number, field: keyof JournalLine, value: string) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    
    // Clear opposite field when one is entered
    if (field === 'debit' && value) {
      newLines[index].credit = '';
    } else if (field === 'credit' && value) {
      newLines[index].debit = '';
    }
    
    setLines(newLines);
  };

  const selectAccount = (index: number, account: Account) => {
    const newLines = [...lines];
    newLines[index] = {
      ...newLines[index],
      account_id: account.id,
      account_code: account.account_code,
      account_name: account.account_name,
    };
    setLines(newLines);
    const newSearch = [...searchAccount];
    newSearch[index] = account.account_name || '';
    setSearchAccount(newSearch);
    const newDropdown = [...showAccountDropdown];
    newDropdown[index] = false;
    setShowAccountDropdown(newDropdown);
  };

  const calculateTotals = () => {
    const totalDebit = lines.reduce((sum, line) => sum + (parseFloat(line.debit || '0')), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (parseFloat(line.credit || '0')), 0);
    return { totalDebit, totalCredit, difference: Math.abs(totalDebit - totalCredit) };
  };

  const totals = calculateTotals();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    // Validation
    const newErrors: Record<string, string> = {};
    
    if (lines.length < 2) {
      newErrors.lines = 'Journal entry must have at least 2 lines';
    }

    lines.forEach((line, index) => {
      if (!line.account_id) {
        newErrors[`line_${index}_account`] = 'Account is required';
      }
      const debit = parseFloat(line.debit || '0');
      const credit = parseFloat(line.credit || '0');
      if (debit === 0 && credit === 0) {
        newErrors[`line_${index}_amount`] = 'Either debit or credit is required';
      }
      if (debit > 0 && credit > 0) {
        newErrors[`line_${index}_amount`] = 'Cannot have both debit and credit';
      }
    });

    if (totals.difference > 0.01) {
      newErrors.balance = `Debit and Credit must be equal. Difference: ₹${totals.difference.toFixed(2)}`;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
          business_id: business.id,
          entry_date: formData.entry_date,
          reference_number: formData.reference_number || null,
          narration: formData.narration || null,
          branch_id: formData.branch_id || null, // CRITICAL: Include branch_id
          created_by: user?.id, // Required for authorization
          backdate_reason: formData.backdate_reason || null, // Include backdate reason
          lines: formData.is_reversing && formData.reverses_entry_id
            ? [] // Lines will be auto-generated from original entry
            : lines.map(line => ({
                account_id: line.account_id,
                debit: parseFloat(line.debit || '0'),
                credit: parseFloat(line.credit || '0'),
                narration: line.narration || null,
              })),
          is_reversing: formData.is_reversing || undefined,
          reverses_entry_id: formData.reverses_entry_id || undefined,
          reversal_date: formData.reversal_date || undefined,
          template_id: formData.template_id || undefined,
          tags: formData.tags.length > 0 ? formData.tags : undefined,
        }),
      });

      if (res.ok) {
        router.push('/journal-entries');
        router.refresh();
      } else {
        const errorData = await safeJsonParse(res);
        setErrors({ submit: getApiErrorMessage(errorData, 'Failed to create journal entry') });
      }
    } catch (error) {
      console.error('Error creating journal entry:', error);
      setErrors({ submit: 'An unexpected error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const filteredAccounts = (index: number) => {
    const search = searchAccount[index]?.toLowerCase() || '';
    return accounts.filter(acc =>
      acc.account_name.toLowerCase().includes(search) ||
      acc.account_code.toLowerCase().includes(search)
    ).slice(0, 10);
  };

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          className="mb-0"
          title="New journal entry"
          description="Record debits and credits"
        />

        <Card padding="md">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Template Selection */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Use Template (Optional)
              </label>
              <select
                value={formData.template_id}
                onChange={(e) => {
                  if (e.target.value) {
                    handleTemplateSelect(e.target.value);
                  } else {
                    setFormData((prev) => ({ ...prev, template_id: '' }));
                  }
                }}
                className="input w-full"
              >
                <option value="">Select a template...</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Reversing Entry Option */}
            <div className="border border-border rounded-lg p-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_reversing}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      is_reversing: e.target.checked,
                      reverses_entry_id: e.target.checked ? prev.reverses_entry_id : '',
                    }))
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm font-medium text-text-primary">Create Reversing Entry</span>
              </label>
              {formData.is_reversing && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Entry to Reverse
                    </label>
                    <select
                      value={formData.reverses_entry_id}
                      onChange={(e) => handleReversingEntrySelect(e.target.value)}
                      className="input w-full"
                      required
                    >
                      <option value="">Select entry to reverse...</option>
                      {availableEntries.map((entry) => (
                        <option key={entry.voucher_id} value={entry.voucher_id}>
                          {entry.voucher_number} - {format(new Date(entry.entry_date), 'dd MMM yyyy')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                      Reversal Date (Optional - for scheduled reversals)
                    </label>
                    <Input
                      type="date"
                      value={formData.reversal_date}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, reversal_date: e.target.value }))
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">Tags</label>
              <div className="flex gap-2 mb-2">
                <Input
                  placeholder="Add a tag"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  className="flex-1"
                />
                <Button type="button" onClick={addTag} variant="secondary">
                  Add
                </Button>
              </div>
              {formData.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-slate-100 text-primary-800 rounded-full text-sm flex items-center gap-2"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="hover:text-primary-900"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Entry Date *"
                type="date"
                value={formData.entry_date}
                onChange={(e) => setFormData({ ...formData, entry_date: e.target.value })}
                required
              />
              <Input
                label="Reference Number"
                value={formData.reference_number}
                onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                placeholder="Optional reference number"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Narration
              </label>
              <textarea
                value={formData.narration}
                onChange={(e) => setFormData({ ...formData, narration: e.target.value })}
                className="input"
                rows={2}
                placeholder="Overall narration for this journal entry"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-text-primary">Entry Lines</h2>
                <Button type="button" onClick={addLine} size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Line
                </Button>
              </div>

              <div className="space-y-4">
                {lines.map((line, index) => (
                  <Card key={line.id} className="p-4">
                    <div className="grid grid-cols-12 gap-4 items-start">
                      <div className="col-span-12 md:col-span-4">
                        <label className="block text-sm font-medium text-text-secondary mb-1">
                          Account *
                        </label>
                        <div className="relative">
                          <Input
                            value={searchAccount[index] || line.account_name || ''}
                            onChange={(e) => {
                              const newSearch = [...searchAccount];
                              newSearch[index] = e.target.value;
                              setSearchAccount(newSearch);
                              const newDropdown = [...showAccountDropdown];
                              newDropdown[index] = true;
                              setShowAccountDropdown(newDropdown);
                            }}
                            onFocus={() => {
                              const newDropdown = [...showAccountDropdown];
                              newDropdown[index] = true;
                              setShowAccountDropdown(newDropdown);
                            }}
                            onBlur={() => {
                              // Delay so a click on a dropdown item fires before we close
                              setTimeout(() => {
                                const newDropdown = [...showAccountDropdown];
                                newDropdown[index] = false;
                                setShowAccountDropdown(newDropdown);
                              }, 200);
                            }}
                            placeholder="Search account..."
                            error={errors[`line_${index}_account`]}
                          />
                          {showAccountDropdown[index] && (
                            <div className="absolute z-10 w-full mt-1 bg-white border border-border rounded-lg shadow-lg max-h-60 overflow-auto">
                              {filteredAccounts(index).map((account) => (
                                <button
                                  key={account.id}
                                  type="button"
                                  onClick={() => selectAccount(index, account)}
                                  className="w-full text-left px-4 py-2 hover:bg-gray-50"
                                >
                                  <div className="font-medium">{account.account_name}</div>
                                  <div className="text-sm text-text-secondary font-mono">{account.account_code}</div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="col-span-6 md:col-span-3">
                        <Input
                          label="Debit"
                          type="number"
                          value={line.debit}
                          onChange={(e) => updateLine(index, 'debit', e.target.value)}
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          error={errors[`line_${index}_amount`]}
                        />
                      </div>
                      <div className="col-span-6 md:col-span-3">
                        <Input
                          label="Credit"
                          type="number"
                          value={line.credit}
                          onChange={(e) => updateLine(index, 'credit', e.target.value)}
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          error={errors[`line_${index}_amount`]}
                        />
                      </div>
                      <div className="col-span-10 md:col-span-1">
                        <Input
                          label="Narration"
                          value={line.narration}
                          onChange={(e) => updateLine(index, 'narration', e.target.value)}
                          placeholder="Line narration"
                        />
                      </div>
                      <div className="col-span-2 md:col-span-1 flex items-end">
                        {lines.length > 2 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(index)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* Totals Summary */}
            <Card className="p-4 bg-gray-50">
              <div className="flex justify-between items-center">
                <div className="flex gap-6">
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Total Debit</label>
                    <p className="text-lg font-semibold text-primary-600">
                      ₹{totals.totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Total Credit</label>
                    <p className="text-lg font-semibold text-green-600">
                      ₹{totals.totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Difference</label>
                    <p className={`text-lg font-semibold ${
                      totals.difference < 0.01 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      ₹{totals.difference.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
                {totals.difference > 0.01 && (
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm font-medium">Debit and Credit must be equal</span>
                  </div>
                )}
              </div>
            </Card>

            {errors.submit && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">{errors.submit}</p>
              </div>
            )}

            <div className="flex justify-end gap-4">
              <Link href="/journal-entries">
                <Button type="button" variant="ghost">Cancel</Button>
              </Link>
              <Button type="submit" disabled={loading || totals.difference > 0.01}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Journal Entry
              </Button>
            </div>
          </form>
        </Card>
      </div>
    
  );
}

