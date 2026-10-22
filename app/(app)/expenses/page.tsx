'use client';

export const dynamic = 'force-dynamic';

import { PageHeader } from '@/components/layout/PageHeader';
import { useEffect, useState } from 'react';
import { Plus, Calendar, DollarSign, Tag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useRouter } from 'next/navigation';
import { ReasonConfirmModal } from '@/components/modals/ReasonConfirmModal';
import {
  canManagePeriodLocks,
  describeAccountingError,
  type AccountingErrorView,
} from '@/lib/accounting-ui/errors';
import { buildReversalUrl, REVERSAL_COPY } from '@/lib/accounting-ui/reversal';
interface Expense {
  id: string;
  amount: number;
  description: string;
  expense_date: string;
  payment_mode: string;
  settlement_account_id?: string | null;
  category_name: string | null;
  category_id: string | null;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  reference_number?: string | null;
  itc_eligible?: boolean;
  is_reverse_charge?: boolean;
  tds_section?: string | null;
  tds_amount?: number;
  supplier_id?: string | null;
  supplier_gstin?: string | null;
  supply_received_on?: string | null;
  supplier_registration_status?: string | null;
  updated_at?: string | null;
}

interface ExpenseCategory {
  id: string;
  name: string;
  itc_blocked?: boolean;
}

export default function ExpensesPage() {
  const router = useRouter();
  const { business, permissions, isPrimaryAdmin } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [reversing, setReversing] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const toast = useToastContext();

  async function reverseExpense(reason: string): Promise<AccountingErrorView | null> {
    if (!reversing || !business?.id) return null;
    let res: Response;
    try {
      res = await fetch(buildReversalUrl(`/api/expenses/${reversing.id}`, business.id, reason), { method: 'DELETE' });
    } catch {
      return { message: 'Could not reach the server. Check your connection and try again.' };
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return describeAccountingError(res.status, data, {
        context: 'expense',
        verb: 'reversed',
        canManagePeriods: canManagePeriodLocks(isPrimaryAdmin, permissions),
        currentPath: '/expenses',
        fallback: 'Could not reverse the expense. Please try again.',
      });
    }
    setReversing(null);
    toast.success(REVERSAL_COPY.success);
    fetchExpenses();
    return null;
  }

  useEffect(() => {
    // Wait for branch context to be ready before fetching
    if (business?.id && !branchLoading) {
      fetchExpenses();
      fetchCategories();
    }
  }, [business, selectedCategory, currentBranchId, branchLoading]);

  useEffect(() => {
    if (!business?.id || branchLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1') return;
    router.replace('/expenses/new');
  }, [business?.id, branchLoading, router]);

  async function fetchExpenses() {
    try {
      let url = `/api/expenses?business_id=${business!.id}`;
      if (selectedCategory) {
        url += `&category_id=${selectedCategory}`;
      }

      const response = await fetch(url);
      const data = await response.json();
      setExpenses(data.expenses || []);
    } catch (error) {
      console.error('Error fetching expenses:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCategories() {
    try {
      const response = await fetch(`/api/expense-categories?business_id=${business!.id}`);
      const data = await response.json();
      setCategories(data.categories || []);
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  }

  const totalExpenses = expenses.reduce((sum, exp) => sum + parseFloat(exp.amount.toString()), 0);

  return (
    
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
  title="Expenses"
  subtitle="Track your business expenses"

  actions={
    <>
<button
            onClick={() => router.push('/expenses/new')}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>Add Expense</span>
          </button>
    </>
  }
/>

        {/* Stats & Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total Expenses Card */}
          <div className="bg-gradient-to-br from-red-50 to-orange-50 rounded-xl p-6 border border-red-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-600 mb-1">Total Expenses</p>
                <p className="text-3xl font-bold text-gray-900">₹{totalExpenses.toLocaleString()}</p>
                <p className="text-xs text-gray-600 mt-1">{expenses.length} transactions</p>
              </div>
              <div className="bg-red-100 p-3 rounded-lg">
                <DollarSign className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>

          {/* Category Filter */}
          <div className="bg-white rounded-xl p-6 border border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Manage Categories */}
          <div className="bg-white rounded-xl p-6 border border-gray-200 flex flex-wrap items-center justify-center gap-6">
            <button
              onClick={() => router.push('/expenses/categories')}
              className="flex items-center space-x-2 text-primary-600 hover:text-primary-700 font-medium"
            >
              <Tag className="w-5 h-5" />
              <span>Manage Categories</span>
            </button>
            <button
              onClick={() => router.push('/expenses/items')}
              className="flex items-center space-x-2 text-primary-600 hover:text-primary-700 font-medium"
            >
              <Tag className="w-5 h-5" />
              <span>Expense items</span>
            </button>
          </div>
        </div>

        {/* Expenses List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : expenses.length === 0 ? (
            <div className="p-12 text-center">
              <DollarSign className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No expenses recorded yet</p>
              <button
                onClick={() => router.push('/expenses/new')}
                className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
              >
                Add Your First Expense
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Date</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Category</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Description</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Payment Mode</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">GST (ITC)</th>
                    <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700">Amount</th>
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <Calendar className="w-4 h-4" />
                          <span>{new Date(expense.expense_date).toLocaleDateString()}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {expense.category_name ? (
                          <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-primary-800">
                            {expense.category_name}
                          </span>
                        ) : (
                          <span className="text-sm text-gray-400">Uncategorized</span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-sm text-gray-900">{expense.description || '-'}</p>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm text-gray-600">
                          {expense.payment_mode === 'on_account'
                            ? 'On account (unpaid)'
                            : expense.payment_mode || 'Cash'}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right text-sm text-gray-600">
                        {(() => {
                          const g =
                            (Number(expense.cgst_amount) || 0) +
                            (Number(expense.sgst_amount) || 0) +
                            (Number(expense.igst_amount) || 0);
                          if (g <= 0) return '—';
                          const label = `₹${g.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
                          if (expense.is_reverse_charge) return `${label} (RCM)`;
                          return expense.itc_eligible === false ? `${label} (blocked)` : label;
                        })()}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-sm font-semibold text-red-600">
                          ₹{parseFloat(expense.amount.toString()).toLocaleString()}
                        </span>
                        {Number(expense.tds_amount) > 0 && (
                          <p className="text-xs text-gray-500">TDS ₹{Number(expense.tds_amount).toLocaleString('en-IN')}</p>
                        )}
                      </td>
                      <td className="py-4 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => router.push(`/expenses/new?edit=${expense.id}`)}
                          className="text-sm text-primary-600 hover:underline mr-3"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setReversing(expense)}
                          className="text-sm text-red-600 hover:underline"
                        >
                          {REVERSAL_COPY.expense.button}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {reversing && (
          <ReasonConfirmModal
            key={reversing.id}
            title={REVERSAL_COPY.expense.title}
            subject={`${reversing.description || 'Expense'} · ₹${Number(reversing.amount).toLocaleString('en-IN')}`}
            description={REVERSAL_COPY.expense.description}
            confirmLabel={REVERSAL_COPY.confirm}
            requireReason
            reasonLabel={REVERSAL_COPY.reasonLabel}
            reasonPlaceholder={REVERSAL_COPY.reasonPlaceholder}
            onConfirm={reverseExpense}
            onClose={() => setReversing(null)}
          />
        )}

        </div>
    
  );
}

