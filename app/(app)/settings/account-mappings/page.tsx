'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Loader2, Save, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Account } from '@/types/database';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface AccountMappings {
  sales_account_id?: string;
  accounts_receivable_account_id?: string;
  cash_account_id?: string;
  bank_account_id?: string;
  purchases_account_id?: string;
  accounts_payable_account_id?: string;
  inventory_account_id?: string;
  cogs_account_id?: string;
  expense_account_id?: string;
  payment_modes?: {
    cash?: string;
    bank?: string;
    upi?: string;
    credit_card?: string;
  };
}

export default function AccountMappingsPage() {
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [mappings, setMappings] = useState<AccountMappings>({});
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (business?.id) {
      fetchData();
    }
  }, [business?.id]);

  const fetchData = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      // Fetch accounts
      const accountsRes = await fetch(`/api/accounts?business_id=${business.id}&is_active=true&user_id=${user?.id}`);
      if (accountsRes.ok) {
        const accountsData = await accountsRes.json();
        setAccounts(accountsData.accounts || []);
      }

      // Fetch mappings
      const mappingsRes = await fetch(`/api/settings/account-mappings?business_id=${business.id}`);
      if (mappingsRes.ok) {
        const mappingsData = await mappingsRes.json();
        setMappings(mappingsData.mappings || {});
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoDetect = async () => {
    if (!business?.id) return;

    setSaving(true);
    try {
      const res = await fetch('/api/settings/account-mappings/auto-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id }),
      });

      if (res.ok) {
        const data = await res.json();
        setMappings(data.mappings || {});
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (error) {
      console.error('Error auto-detecting mappings:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!business?.id) return;

    setSaving(true);
    try {
      const res = await fetch('/api/settings/account-mappings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          mappings,
        }),
      });

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    } catch (error) {
      console.error('Error saving mappings:', error);
    } finally {
      setSaving(false);
    }
  };

  const getAccountName = (accountId?: string) => {
    if (!accountId) return 'Not set';
    const account = accounts.find(a => a.id === accountId);
    return account ? `${account.account_code} - ${account.account_name}` : 'Not found';
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Account Mappings</h1>
            <p className="text-sm text-text-secondary mt-1">
              Configure which accounts are used for different transaction types
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={handleAutoDetect} disabled={saving}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Auto-Detect
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Changes
            </Button>
          </div>
        </div>

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="text-green-800">Account mappings saved successfully!</span>
          </div>
        )}

        <Card>
          <div className="space-y-6 p-6">
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Sales & Receivables</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Sales Account
                  </label>
                  <select
                    value={mappings.sales_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, sales_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'income')
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.sales_account_id)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Accounts Receivable
                  </label>
                  <select
                    value={mappings.accounts_receivable_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, accounts_receivable_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'asset' && a.account_name.toLowerCase().includes('receivable'))
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.accounts_receivable_account_id)}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Purchases & Payables</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Purchases Account
                  </label>
                  <select
                    value={mappings.purchases_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, purchases_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'expense' && a.account_name.toLowerCase().includes('purchase'))
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.purchases_account_id)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Accounts Payable
                  </label>
                  <select
                    value={mappings.accounts_payable_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, accounts_payable_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'liability' && a.account_name.toLowerCase().includes('payable'))
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.accounts_payable_account_id)}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Cash & Bank</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Cash Account
                  </label>
                  <select
                    value={mappings.cash_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, cash_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'asset' && a.account_name.toLowerCase().includes('cash'))
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.cash_account_id)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Bank Account
                  </label>
                  <select
                    value={mappings.bank_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, bank_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'asset' && a.account_name.toLowerCase().includes('bank'))
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.bank_account_id)}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-4">Inventory & Expenses</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Inventory Account
                  </label>
                  <select
                    value={mappings.inventory_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, inventory_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'asset' && a.account_name.toLowerCase().includes('inventory'))
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.inventory_account_id)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    COGS Account
                  </label>
                  <select
                    value={mappings.cogs_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, cogs_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'expense' && (a.account_name.toLowerCase().includes('cogs') || a.account_name.toLowerCase().includes('cost of goods')))
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.cogs_account_id)}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Expense Account
                  </label>
                  <select
                    value={mappings.expense_account_id || ''}
                    onChange={(e) => setMappings({ ...mappings, expense_account_id: e.target.value || undefined })}
                    className="w-full p-2 border border-border rounded-md"
                  >
                    <option value="">Select account...</option>
                    {accounts
                      .filter(a => a.account_type === 'expense')
                      .map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} - {acc.account_name}
                        </option>
                      ))}
                  </select>
                  <p className="text-xs text-text-secondary mt-1">
                    Current: {getAccountName(mappings.expense_account_id)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    
  );
}

