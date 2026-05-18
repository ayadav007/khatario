'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, Lock, Unlock, Calendar, Building2, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { safeJsonParse, getApiErrorMessage } from '@/lib/api-utils';
import { format } from 'date-fns';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface PeriodLock {
  id: string;
  business_id: string;
  branch_id: string | null;
  branch_name: string | null;
  financial_year: string;
  period_start: string;
  period_end: string;
  is_locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
  locked_by_name: string | null;
  notes: string | null;
}

interface Branch {
  id: string;
  name: string;
}

export default function PeriodLocksPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    branch_id: '',
    financial_year: '',
    period_start: '',
    period_end: '',
    is_locked: true,
    notes: '',
  });

  useEffect(() => {
    if (business?.id) {
      fetchLocks();
      fetchBranches();
    }
  }, [business]);

  async function fetchLocks() {
    if (!business?.id) return;
    
    try {
      const response = await fetch(`/api/period-locks?business_id=${business.id}&user_id=${user?.id}`);
      const data = await response.json();
      setLocks(data.locks || []);
    } catch (error) {
      console.error('Error fetching period locks:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchBranches() {
    if (!business?.id) return;
    
    try {
      const response = await fetch(`/api/branches?business_id=${business.id}&user_id=${user?.id}`);
      const data = await response.json();
      setBranches(data.branches || []);
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!business?.id) return;

    setSaving(true);
    try {
      const response = await fetch('/api/period-locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          branch_id: formData.branch_id || null,
          financial_year: formData.financial_year,
          period_start: formData.period_start,
          period_end: formData.period_end,
          is_locked: formData.is_locked,
          notes: formData.notes || null,
          created_by_user_id: user?.id, // Required for authorization
        }),
      });

      if (response.ok) {
        await fetchLocks();
        setShowForm(false);
        setFormData({
          branch_id: '',
          financial_year: '',
          period_start: '',
          period_end: '',
          is_locked: true,
          notes: '',
        });
      } else {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Failed to create period lock'));
      }
    } catch (error) {
      console.error('Error creating period lock:', error);
      toast.error('Failed to create period lock');
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlock(lockId: string) {
    if (!confirm('Are you sure you want to unlock this period? This will allow entries to be created in this period.')) {
      return;
    }

    try {
      const response = await fetch(`/api/period-locks?id=${lockId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchLocks();
      } else {
        const error = await safeJsonParse(response);
        toast.error(getApiErrorMessage(error, 'Failed to unlock period'));
      }
    } catch (error) {
      console.error('Error unlocking period:', error);
      toast.error('Failed to unlock period');
    }
  }

  // Get current financial year
  const getCurrentFinancialYear = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 4) {
      return `${year}-${(year + 1).toString().slice(-2)}`;
    } else {
      return `${year - 1}-${year.toString().slice(-2)}`;
    }
  };

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      
    );
  }

  return (
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Period Locks</h1>
            <p className="text-text-secondary text-sm mt-1">Lock accounting periods to prevent backdated entries</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition"
          >
            <Plus className="w-5 h-5" />
            <span>Lock Period</span>
          </button>
        </div>

        {/* Info Banner */}
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-900">About Period Locks</p>
              <p className="text-sm text-amber-700 mt-1">
                Locked periods prevent creating or modifying transactions. This ensures data integrity after closing a period. 
                Only past periods can be locked. Unlocking requires careful consideration.
              </p>
            </div>
          </div>
        </div>

        {/* Create Form Modal */}
        {showForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-surface dark:bg-slate-900/70 rounded-xl max-w-2xl w-full p-6">
              <div className="flex justify-between items-start mb-6">
                <h2 className="text-xl font-bold text-text-primary">Lock Period</h2>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-text-muted hover:text-text-secondary"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Branch (Optional)
                  </label>
                  <select
                    value={formData.branch_id}
                    onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  >
                    <option value="">All Branches (Business-wide)</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-text-muted mt-1">Leave empty to lock for all branches</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Financial Year *
                  </label>
                  <input
                    type="text"
                    value={formData.financial_year}
                    onChange={(e) => setFormData({ ...formData, financial_year: e.target.value })}
                    placeholder={getCurrentFinancialYear()}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                  <p className="text-xs text-text-muted mt-1">Format: YYYY-YY (e.g., 2024-25)</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Period Start *
                    </label>
                    <input
                      type="date"
                      value={formData.period_start}
                      onChange={(e) => setFormData({ ...formData, period_start: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-secondary mb-1">
                      Period End *
                    </label>
                    <input
                      type="date"
                      value={formData.period_end}
                      onChange={(e) => setFormData({ ...formData, period_end: e.target.value })}
                      className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    rows={3}
                    placeholder="Reason for locking this period..."
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-4 py-2 border border-border rounded-lg bg-surface hover:bg-gray-50 dark:hover:bg-slate-800/80"
                    disabled={saving}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    disabled={saving}
                  >
                    {saving ? 'Locking...' : 'Lock Period'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Locks Table */}
        <div className="bg-surface dark:bg-slate-900/70 rounded-xl shadow-sm border border-border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-slate-800/40 border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Branch</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Financial Year</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Period</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Locked By</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Notes</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {locks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                    No period locks found. Create one to prevent entries in closed periods.
                  </td>
                </tr>
              ) : (
                locks.map((lock) => (
                  <tr key={lock.id} className="hover:bg-gray-50 dark:bg-slate-800/40 dark:hover:bg-slate-800/70">
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {lock.branch_name || (
                        <span className="text-text-muted italic">All Branches</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">{lock.financial_year}</td>
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {format(new Date(lock.period_start), 'dd MMM yyyy')} - {format(new Date(lock.period_end), 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      {lock.is_locked ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                          <Lock className="w-3 h-3" />
                          <span>Locked</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                          <Unlock className="w-3 h-3" />
                          <span>Unlocked</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {lock.locked_by_name || '-'}
                      {lock.locked_at && (
                        <div className="text-xs text-text-muted">
                          {format(new Date(lock.locked_at), 'dd MMM yyyy')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {lock.notes || '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {lock.is_locked && (
                        <button
                          onClick={() => handleUnlock(lock.id)}
                          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                        >
                          Unlock
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    
  );
}
