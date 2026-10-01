'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Edit, Loader2, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Account } from '@/types/database';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { format } from 'date-fns';
import { DeleteAction } from '@/components/common/DeleteAction';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';
import { PlSectionSelect } from '@/components/accounts/PlSectionSelect';
import {
  effectivePlSection,
  plSectionFromGroup,
  type PlSection,
} from '@/lib/accounting/pl-sections';

type AccountDetail = Account & {
  account_group_name: string;
  account_group_code?: string | null;
  account_group_type?: string | null;
  pl_section?: string | null;
  current_balance?: number;
};

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { business, user } = useAuth();
  const accountId = params.id as string;
  const [account, setAccount] = useState<AccountDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [plSection, setPlSection] = useState<PlSection | ''>('');
  const [plSaving, setPlSaving] = useState(false);
  const [plMessage, setPlMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useMobileHeaderTitleOverride(account?.account_name);

  useEffect(() => {
    if (accountId && business?.id) {
      fetchAccount();
    }
  }, [accountId, business?.id]);

  const fetchAccount = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/accounts/${accountId}?business_id=${business.id}&include_balance=true`);
      if (res.ok) {
        const data = await res.json();
        setAccount(data.account);
        const a = data.account as AccountDetail;
        const fromGroup = plSectionFromGroup(a.account_type, a.account_group_code, a.account_group_type);
        const effective = effectivePlSection({ ...a, group_code: a.account_group_code, group_type: a.account_group_type });
        setPlSection(effective && effective !== fromGroup ? effective : '');
      } else {
        router.push('/accounts');
      }
    } catch (error) {
      console.error('Error fetching account:', error);
      router.push('/accounts');
    } finally {
      setLoading(false);
    }
  };

  const savePlSection = async () => {
    if (!account || !business?.id || !user?.id) return;
    const section =
      plSection || plSectionFromGroup(account.account_type, account.account_group_code, account.account_group_type);
    setPlSaving(true);
    setPlMessage(null);
    try {
      const res = await fetch(`/api/accounts/${accountId}?business_id=${business.id}&user_id=${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pl_section: section }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to save');
      setPlMessage({ ok: true, text: 'Saved. The Profit & Loss report uses the new section.' });
      await fetchAccount();
    } catch (e: any) {
      setPlMessage({ ok: false, text: e.message || 'Failed to save' });
    } finally {
      setPlSaving(false);
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  if (!account) {
    return (
      
        <div className="text-center py-12">
          <p className="text-text-secondary">Account not found</p>
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <MobileDuplicatePageChrome
          className="mb-0"
          title={account.account_name}
          description={`Account Code: ${account.account_code}`}
          trailing={
            !account.is_system ? (
              <div className="flex items-center gap-2">
                <Link href={`/accounts/${accountId}/edit`}>
                  <Button>
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Account
                  </Button>
                </Link>
                <DeleteAction
                  entityName="account"
                  variant="deactivate"
                  confirmMessage="This account will be deactivated. Existing transactions will remain intact."
                  disabled={!account.is_active}
                  disabledTooltip="Account is already inactive"
                  deleteFn={async () => {
                    if (!business?.id || !user?.id) throw new Error('Missing business/user context');
                    const res = await fetch(
                      `/api/accounts/${accountId}?business_id=${business.id}&user_id=${user.id}`,
                      {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ is_active: false }),
                      }
                    );
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) throw new Error(data?.error || 'Failed to deactivate account');
                  }}
                  onSuccess={async () => {
                    await fetchAccount();
                  }}
                />
              </div>
            ) : undefined
          }
        />

        <Card>
          <div className="space-y-6">
            <div className="hidden md:block">
              <p className="text-sm text-text-secondary">Account Code: {account.account_code}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium text-text-secondary">Account Type</label>
                <p className="mt-1 text-text-primary">{account.account_type}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Account Group</label>
                <p className="mt-1 text-text-primary">{account.account_group_name}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Nature</label>
                <p className="mt-1">
                  <span className={`px-2 py-1 rounded-md text-xs ${
                    account.nature === 'debit' ? 'bg-slate-100 text-primary-800' : 'bg-green-100 text-green-800'
                  }`}>
                    {account.nature}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Status</label>
                <p className="mt-1">
                  {account.is_system && (
                    <span className="px-2 py-1 rounded-md text-xs bg-slate-100 text-primary-800">System Account</span>
                  )}
                  {account.is_active ? (
                    <span className="px-2 py-1 rounded-md text-xs bg-green-100 text-green-800">Active</span>
                  ) : (
                    <span className="px-2 py-1 rounded-md text-xs bg-gray-100 text-gray-800">Inactive</span>
                  )}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-text-secondary">Opening Balance</label>
                <p className="mt-1 text-text-primary">
                  ₹{Number(account.opening_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} 
                  ({account.opening_balance_type})
                </p>
              </div>
              {account.current_balance !== undefined && (
                <div>
                  <label className="text-sm font-medium text-text-secondary">Current Balance</label>
                  <p className="mt-1 text-lg font-semibold text-text-primary">
                    ₹{Number(account.current_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              )}
            </div>

            {(account.account_type === 'income' || account.account_type === 'expense') && (
              <div className="pt-4 border-t border-border">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <PlSectionSelect
                    accountType={account.account_type}
                    value={plSection}
                    defaultSection={plSectionFromGroup(account.account_type, account.account_group_code, account.account_group_type)}
                    onChange={(v) => { setPlSection(v); setPlMessage(null); }}
                    disabled={!!account.is_system}
                    disabledReason="System accounts keep their standard Profit & Loss section."
                  />
                  {!account.is_system && (
                    <div className="pb-6">
                      <Button type="button" variant="secondary" onClick={savePlSection} disabled={plSaving}>
                        {plSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        Save section
                      </Button>
                    </div>
                  )}
                </div>
                {plMessage && (
                  <p className={`text-sm mt-1 ${plMessage.ok ? 'text-green-700' : 'text-red-600'}`}>{plMessage.text}</p>
                )}
              </div>
            )}

            {account.description && (
              <div>
                <label className="text-sm font-medium text-text-secondary">Description</label>
                <p className="mt-1 text-text-primary">{account.description}</p>
              </div>
            )}

            <div className="pt-4 border-t border-border flex gap-3">
              <Link href={`/ledger/account/${accountId}`}>
                <Button>
                  <FileText className="w-4 h-4 mr-2" />
                  View Ledger
                </Button>
              </Link>
              <Link href={`/accounts/${accountId}/reconciliation`}>
                <Button variant="secondary">
                  <FileText className="w-4 h-4 mr-2" />
                  Reconciliation
                </Button>
              </Link>
            </div>
          </div>
        </Card>
      </div>
    
  );
}

