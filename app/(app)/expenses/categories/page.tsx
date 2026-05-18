'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { Plus, Tag, Loader2, ArrowLeft } from 'lucide-react';

interface LedgerAccountOption {
  id: string;
  account_code: string;
  account_name: string;
}

interface ExpenseCategory {
  id: string;
  name: string;
  description?: string;
  account_id?: string | null;
  ledger_account_code?: string | null;
  ledger_account_name?: string | null;
  created_at: string;
}

export default function ExpenseCategoriesPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<LedgerAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAccountFor, setSavingAccountFor] = useState<string | null>(null);
  const [accountDraftByCategory, setAccountDraftByCategory] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState({
    name: '',
    description: '',
    account_id: '' as string,
  });

  useEffect(() => {
    if (business?.id) {
      fetchCategories();
    }
  }, [business?.id]);

  useEffect(() => {
    async function loadAccounts() {
      if (!business?.id || !user?.id) return;
      try {
        const params = new URLSearchParams({
          business_id: business.id,
          user_id: user.id,
          account_type: 'expense',
          is_active: 'true',
          limit: '500',
          page: '1',
        });
        const res = await fetch(`/api/accounts?${params.toString()}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        setExpenseAccounts(data.accounts || []);
      } catch {
        /* ignore */
      }
    }
    loadAccounts();
  }, [business?.id, user?.id]);

  const fetchCategories = async () => {
    if (!business?.id) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/expense-categories?business_id=${business.id}`);
      if (response.ok) {
        const data = await response.json();
        const list: ExpenseCategory[] = data.categories || [];
        setCategories(list);
        const drafts: Record<string, string> = {};
        for (const c of list) {
          drafts[c.id] = c.account_id || '';
        }
        setAccountDraftByCategory(drafts);
      } else {
        toast.error('Failed to load categories');
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      toast.error('Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !newCategory.name.trim()) {
      toast.error('Category name is required');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/expense-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          name: newCategory.name.trim(),
          description: newCategory.description.trim() || null,
          account_id: newCategory.account_id || null,
        })
      });

      if (response.ok) {
        toast.success('Category added successfully');
        setNewCategory({ name: '', description: '', account_id: '' });
        setShowAddForm(false);
        fetchCategories();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to add category');
      }
    } catch (error) {
      console.error('Error adding category:', error);
      toast.error('Failed to add category');
    } finally {
      setSaving(false);
    }
  };

  async function saveCategoryAccount(categoryId: string) {
    if (!business?.id) return;
    const accountId = accountDraftByCategory[categoryId] ?? '';
    setSavingAccountFor(categoryId);
    try {
      const res = await fetch(`/api/expense-categories/${categoryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          account_id: accountId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Failed to update ledger account');
        return;
      }
      toast.success('Ledger account updated');
      fetchCategories();
    } catch (e) {
      console.error(e);
      toast.error('Failed to update ledger account');
    } finally {
      setSavingAccountFor(null);
    }
  }

  return (
    
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/expenses')}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            title="Back to Expenses"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Expense Categories</h1>
            <p className="text-gray-600 text-sm mt-1">Organize expenses by category</p>
          </div>
        </div>

        {/* Add Category */}
        <Card padding="lg">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Add Category</h3>
              <p className="text-sm text-gray-600">Create categories to group your expenses.</p>
            </div>
            <Button onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? 'secondary' : 'primary'}>
              <Plus className="w-4 h-4 mr-2" />
              {showAddForm ? 'Close' : 'New Category'}
            </Button>
          </div>

          {showAddForm && (
            <form onSubmit={handleAddCategory} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Category Name *"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  placeholder="e.g., Travel, Utilities, Rent"
                  required
                />
                <Input
                  label="Description"
                  value={newCategory.description}
                  onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ledger expense account
                </label>
                <select
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  value={newCategory.account_id}
                  onChange={(e) => setNewCategory({ ...newCategory, account_id: e.target.value })}
                >
                  <option value="">Default — use business generic expense account</option>
                  {expenseAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_code} — {a.account_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Optional. When set, expenses in this category debit this account in the ledger.
                </p>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Category'}
                </Button>
              </div>
            </form>
          )}
        </Card>

        {/* Categories List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : categories.length === 0 ? (
          <Card padding="lg">
            <div className="text-center text-gray-500">
              <Tag className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No expense categories yet</p>
              <p className="text-sm mt-1">Add a category to organize your expenses</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categories.map((category) => (
              <Card key={category.id} padding="md" className="hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Tag className="w-5 h-5 text-primary-600" />
                      <h3 className="text-lg font-semibold text-gray-900">{category.name}</h3>
                    </div>
                    {category.description && (
                      <p className="text-sm text-gray-600 mb-2">{category.description}</p>
                    )}
                    <p className="text-xs text-gray-600 mb-2">
                      <span className="font-medium text-gray-700">Ledger: </span>
                      {category.ledger_account_code
                        ? `${category.ledger_account_code} — ${category.ledger_account_name}`
                        : 'Default generic expense account'}
                    </p>
                    <div className="mt-3 space-y-2">
                      <label className="block text-xs font-medium text-gray-600">
                        Post expenses in this category to
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                          value={accountDraftByCategory[category.id] ?? category.account_id ?? ''}
                          onChange={(e) =>
                            setAccountDraftByCategory((prev) => ({
                              ...prev,
                              [category.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Default — generic expense account</option>
                          {expenseAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.account_code} — {a.account_name}
                            </option>
                          ))}
                        </select>
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={savingAccountFor === category.id}
                          onClick={() => saveCategoryAccount(category.id)}
                        >
                          {savingAccountFor === category.id ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Created on {new Date(category.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    
  );
}

