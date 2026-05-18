'use client';

import { useEffect, useState } from 'react';
import { Search, Building2, Eye, TrendingUp, Users, Package, Calendar, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface Business {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  gstin: string | null;
  created_at: string;
  plan_id: string | null;
  plan_name: string | null;
  price_monthly: number | null;
  invoice_count: number;
  customer_count: number;
  item_count: number;
  last_invoice_date: string | null;
}

export default function BusinessesManagement() {
  const { admin, loading: adminLoading } = useAdmin();
  const router = useRouter();
  const toast = useToastContext();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (adminLoading) return;
    if (!admin?.id) {
      setLoading(false);
      return;
    }
    fetchBusinesses();
  }, [search, page, admin?.id, adminLoading]);

  async function fetchBusinesses() {
    if (!admin?.id) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/businesses?search=${encodeURIComponent(search)}&page=${page}`, {
        ...platformAdminFetchInit,
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Failed to load businesses');
        setBusinesses([]);
        setTotalPages(1);
        return;
      }
      setBusinesses(data.businesses || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (error) {
      console.error('Error fetching businesses:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1); // Reset to first page on search
  }

  async function handleDelete(businessId: string, businessName: string) {
    setDeleteConfirm({ id: businessId, name: businessName });
  }

  async function confirmDelete() {
    if (!deleteConfirm || !admin?.id) return;

    try {
      setDeletingId(deleteConfirm.id);
      const response = await fetch(`/api/admin/businesses/${deleteConfirm.id}`, {
        ...platformAdminFetchInit,
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        toast.error(`Failed to delete business: ${data.error || 'Unknown error'}`);
        return;
      }

      // Remove from list
      setBusinesses(businesses.filter(b => b.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    } catch (error) {
      console.error('Error deleting business:', error);
      toast.error('Failed to delete business');
    } finally {
      setDeletingId(null);
    }
  }

  const getPlanBadgeColor = (planId: string | null) => {
    const colors: Record<string, string> = {
      free: 'bg-gray-100 text-gray-700',
      professional: 'bg-slate-100 text-primary-700',
      business: 'bg-purple-100 text-purple-700',
      enterprise: 'bg-orange-100 text-orange-700',
    };
    return planId ? colors[planId] || 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Businesses</h1>
        <p className="text-gray-600 mt-2">Manage all registered businesses on the platform</p>
      </div>

      {/* Search Bar */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by business name, email, or phone..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Businesses Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : businesses.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Building2 className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p>No businesses found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Business</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Contact</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Location</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Plan</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Activity</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Joined</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((business) => (
                  <tr key={business.id} className="border-b border-gray-100 hover:bg-gray-50">
                    {/* Business Name */}
                    <td className="py-4 px-4">
                      <div>
                        <p className="font-medium text-gray-900">{business.name}</p>
                        {business.gstin && (
                          <p className="text-xs text-gray-500 mt-1">GSTIN: {business.gstin}</p>
                        )}
                      </div>
                    </td>

                    {/* Contact */}
                    <td className="py-4 px-4">
                      <div className="text-sm">
                        {business.email && <p className="text-gray-900">{business.email}</p>}
                        {business.phone && <p className="text-gray-500">{business.phone}</p>}
                        {!business.email && !business.phone && <p className="text-gray-400">-</p>}
                      </div>
                    </td>

                    {/* Location */}
                    <td className="py-4 px-4">
                      <div className="text-sm text-gray-600">
                        {business.city && business.state ? (
                          <>
                            {business.city}, {business.state}
                          </>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </div>
                    </td>

                    {/* Plan */}
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getPlanBadgeColor(
                          business.plan_id
                        )}`}
                      >
                        {business.plan_name || 'Free'}
                      </span>
                      {business.price_monthly && business.price_monthly > 0 && (
                        <p className="text-xs text-gray-500 mt-1">₹{business.price_monthly}/mo</p>
                      )}
                    </td>

                    {/* Activity Stats */}
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-3 text-xs text-gray-600">
                        <div className="flex items-center space-x-1">
                          <TrendingUp className="w-3 h-3" />
                          <span>{business.invoice_count}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Users className="w-3 h-3" />
                          <span>{business.customer_count}</span>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Package className="w-3 h-3" />
                          <span>{business.item_count}</span>
                        </div>
                      </div>
                      {business.last_invoice_date && (
                        <p className="text-xs text-gray-500 mt-1">
                          Last: {new Date(business.last_invoice_date).toLocaleDateString()}
                        </p>
                      )}
                    </td>

                    {/* Joined Date */}
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-1 text-sm text-gray-600">
                        <Calendar className="w-4 h-4" />
                        <span>{new Date(business.created_at).toLocaleDateString()}</span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-4">
                      <div className="flex items-center space-x-2">
                        <Link
                          href={`/admin/businesses/${business.id}`}
                          className="inline-flex items-center space-x-1 px-3 py-1 bg-slate-100 text-primary-700 rounded-lg hover:bg-primary-200 transition text-sm font-medium"
                        >
                          <Eye className="w-4 h-4" />
                          <span>View</span>
                        </Link>
                        <button
                          onClick={() => handleDelete(business.id, business.name)}
                          disabled={deletingId === business.id}
                          className="inline-flex items-center space-x-1 px-3 py-1 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-between items-center p-4 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              Page {page} of {totalPages}
            </p>
            <div className="flex space-x-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Confirm Delete</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? 
              This action cannot be undone and will delete all associated data including:
            </p>
            <ul className="list-disc list-inside text-sm text-gray-600 mb-6 space-y-1">
              <li>All users and accounts</li>
              <li>All customers, suppliers, and items</li>
              <li>All invoices, purchases, and expenses</li>
              <li>All subscriptions and addons</li>
              <li>All financial records and ledger entries</li>
            </ul>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deletingId !== null}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deletingId ? 'Deleting...' : 'Delete Business'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

