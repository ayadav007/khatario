'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Edit, FileText, Loader2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { getApiErrorMessage, safeJsonParse } from '@/lib/api-utils';
import { AddToMyAccountsDialog } from '@/components/accounts/AddToMyAccountsDialog';

type MyAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  nature: string | null;
  is_active: boolean;
  is_system: boolean;
  parent_account_id: string | null;
  account_group_id: string | null;
  reason: 'activity' | 'manual' | 'ancestor';
  has_activity: boolean;
  debit: number;
  credit: number;
  opening?: number;
  opening_side?: 'Dr' | 'Cr' | null;
  closing?: number;
  balance_side?: 'Dr' | 'Cr' | null;
};

type MyGroup = {
  id: string;
  group_code: string;
  group_name: string;
  parent_group_id: string | null;
};

type MyNode = MyAccount & { children: MyNode[] };

function money(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sided(amount: number, side?: 'Dr' | 'Cr' | null): string {
  if (!side || amount === 0) return money(0);
  return `${side} ${money(amount)}`;
}

function buildTree(rows: MyAccount[]): MyNode[] {
  const nodes = new Map<string, MyNode>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });
  const roots: MyNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_account_id ? nodes.get(node.parent_account_id) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: MyNode[]) => {
    list.sort((a, b) => a.account_code.localeCompare(b.account_code, undefined, { numeric: true }));
    list.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

function prune(nodes: MyNode[], query: string): MyNode[] {
  if (!query) return nodes;
  const q = query.toLowerCase();
  return nodes.flatMap((node) => {
    const children = prune(node.children, query);
    const group = `${node.account_code} ${node.account_name} ${node.account_type}`.toLowerCase();
    return group.includes(q) || children.length ? [{ ...node, children }] : [];
  });
}

export function MyAccountsView({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const [accounts, setAccounts] = useState<MyAccount[]>([]);
  const [groups, setGroups] = useState<MyGroup[]>([]);
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/accounts/my-accounts');
      const data = await safeJsonParse<{
        accounts?: MyAccount[];
        groups?: MyGroup[];
        manual_account_ids?: string[];
      }>(res);
      if (!res.ok || !data) {
        setError(getApiErrorMessage(data, 'Could not load My Accounts'));
        setAccounts([]);
        return;
      }
      setAccounts(data.accounts || []);
      setGroups(data.groups || []);
      setManualIds(data.manual_account_ids || []);
    } catch {
      setError('Could not load My Accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAccounts([]);
    setGroups([]);
    setManualIds([]);
    setCollapsed(new Set());
    setSearch('');
    void load();
    // Reload when the signed-in business changes so another business's rows are not kept.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const groupName = useMemo(() => new Map(groups.map((group) => [group.id, group.group_name])), [groups]);
  const tree = useMemo(() => prune(buildTree(accounts), search.trim()), [accounts, search]);

  const removeManual = async (accountId: string) => {
    setRemovingId(accountId);
    try {
      const res = await fetch('/api/accounts/my-accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_ids: manualIds.filter((id) => id !== accountId) }),
      });
      const data = await safeJsonParse(res);
      if (!res.ok) {
        toast.error(getApiErrorMessage(data, 'Could not update My Accounts'));
        return;
      }
      toast.success('Removed from My Accounts. The account and its balance were not changed.');
      await load();
    } catch {
      toast.error('Could not update My Accounts');
    } finally {
      setRemovingId(null);
    }
  };

  const renderNode = (node: MyNode, level: number) => {
    const hasChildren = node.children.length > 0;
    const open = search.trim().length > 0 || !collapsed.has(node.id);
    const group = node.account_group_id ? groupName.get(node.account_group_id) : undefined;
    return (
      <div key={node.id} className="border-b border-border">
        <div
          className="flex min-w-0 items-start gap-2 py-3 pr-3 hover:bg-gray-50"
          data-testid={`my-account-${node.account_code}`}
          style={{ paddingLeft: `${Math.min(level, 8) * 12 + 8}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="mt-0.5 shrink-0 text-text-secondary"
              aria-expanded={open}
              aria-label={open ? `Collapse ${node.account_name}` : `Expand ${node.account_name}`}
              onClick={() => {
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                });
              }}
            >
              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="break-words font-medium text-text-primary">{node.account_name}</div>
            <div className="mt-0.5 break-words text-sm text-text-secondary">
              {node.account_code}
              {group ? ` · ${group}` : ''} · {node.account_type}
              {node.reason === 'ancestor' ? ' · Shown for the accounts under it' : ''}
              {node.reason === 'manual' ? ' · Added by you' : ''}
            </div>
            {node.has_activity ? (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums text-text-primary">
                <span>Opening {sided(node.opening || 0, node.opening_side)}</span>
                <span>Dr {money(node.debit)}</span>
                <span>Cr {money(node.credit)}</span>
                <span>Closing {money(node.closing || 0)}</span>
                <span>Balance {sided(node.closing || 0, node.balance_side)}</span>
              </div>
            ) : (
              <div className="mt-1 text-sm text-text-secondary">No posted entries on this account</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Link href={`/accounts/${node.id}`} aria-label={`View ${node.account_name}`}>
              <Button size="sm" variant="ghost" type="button">
                <FileText className="h-4 w-4" />
              </Button>
            </Link>
            {!node.is_system && (
              <Link href={`/accounts/${node.id}/edit`} aria-label={`Edit ${node.account_name}`}>
                <Button size="sm" variant="ghost" type="button">
                  <Edit className="h-4 w-4" />
                </Button>
              </Link>
            )}
            {node.reason === 'manual' && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={removingId === node.id}
                onClick={() => void removeManual(node.id)}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
        {hasChildren && open && <div>{node.children.map((child) => renderNode(child, level + 1))}</div>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
            <Input
              placeholder="Search my accounts..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10"
              aria-label="Search my accounts"
            />
          </div>
          <Button type="button" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Accounts
          </Button>
        </div>
      </div>

      <div className="card min-w-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-red-600" role="alert">{error}</p>
        ) : accounts.length === 0 ? (
          <div className="space-y-2 p-6">
            <p className="font-medium text-text-primary">No accounts yet</p>
            <p className="text-sm text-text-secondary">
              Accounts show up here after a posted entry, including an opening balance. You can also add an existing account so it stays on this list. Adding one does not create an account or post an entry.
            </p>
          </div>
        ) : tree.length === 0 ? (
          <p className="p-6 text-sm text-text-secondary">No accounts match that search.</p>
        ) : (
          <div>{tree.map((node) => renderNode(node, 0))}</div>
        )}
      </div>

      <AddToMyAccountsDialog
        open={addOpen}
        businessId={businessId}
        visibleIds={accounts.map((account) => account.id)}
        manualIds={manualIds}
        onClose={() => setAddOpen(false)}
        onSaved={async () => {
          setAddOpen(false);
          await load();
        }}
      />
    </div>
  );
}
