'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit2, Search, Filter, CheckCircle, XCircle, BarChart3, FileText, TrendingUp, Receipt } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

interface ReportDefinition {
  id: string;
  name: string;
  description: string | null;
  route_path: string;
  category: 'basic' | 'gst' | 'advanced';
  report_type: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface GroupedReports {
  [category: string]: ReportDefinition[];
}

const categoryLabels: Record<string, string> = {
  basic: 'Basic Reports',
  gst: 'GST Reports',
  advanced: 'Advanced Reports'
};

const categoryIcons: Record<string, any> = {
  basic: FileText,
  gst: Receipt,
  advanced: TrendingUp
};

const categoryColors: Record<string, string> = {
  basic: 'bg-slate-50 border-primary-200 text-primary-900',
  gst: 'bg-green-50 border-green-200 text-green-900',
  advanced: 'bg-purple-50 border-purple-200 text-purple-900'
};

export default function ReportsManagement() {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [reports, setReports] = useState<GroupedReports>({});
  const [allReports, setAllReports] = useState<ReportDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingReport, setEditingReport] = useState<ReportDefinition | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchReports();
  }, []);

  async function fetchReports() {
    try {
      const response = await fetch('/api/admin/reports', { ...platformAdminFetchInit });
      const data = await response.json();
      setReports(data.reports || {});
      
      // Flatten for search/filter
      const flat: ReportDefinition[] = [];
      Object.values(data.reports || {}).forEach((categoryReports: any) => {
        flat.push(...categoryReports);
      });
      setAllReports(flat);
    } catch (error) {
      console.error('Error fetching reports:', error);
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(report: ReportDefinition) {
    setEditingReport(report);
    setShowEditModal(true);
  }

  function handleAdd() {
    setEditingReport({
      id: '',
      name: '',
      description: null,
      route_path: '',
      category: 'basic',
      report_type: null,
      is_active: true,
      sort_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    setShowAddModal(true);
  }

  async function handleSave(formData: Partial<ReportDefinition>) {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/reports', {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save report');
      }

      await fetchReports();
      setShowEditModal(false);
      setShowAddModal(false);
      setEditingReport(null);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save report');
    } finally {
      setSaving(false);
    }
  }

  // Filter reports
  const filteredReports = allReports.filter(report => {
    const matchesSearch = !searchTerm || 
      report.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      report.route_path.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (report.description && report.description.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesCategory = filterCategory === 'all' || report.category === filterCategory;
    
    return matchesSearch && matchesCategory;
  });

  // Group filtered reports
  const groupedFiltered = filteredReports.reduce((acc: GroupedReports, report) => {
    if (!acc[report.category]) {
      acc[report.category] = [];
    }
    acc[report.category].push(report);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">Loading reports...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Reports Management</h1>
        <p className="text-gray-600">Manage report definitions and their category assignments</p>
      </div>

      {/* Search and Filter */}
      <div className="mb-6 flex gap-4 items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search reports by name, route, or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="pl-10 pr-8 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent appearance-none bg-white"
          >
            <option value="all">All Categories</option>
            <option value="basic">Basic</option>
            <option value="gst">GST</option>
            <option value="advanced">Advanced</option>
          </select>
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Report
        </button>
      </div>

      {/* Reports by Category */}
      {Object.keys(groupedFiltered).length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {searchTerm || filterCategory !== 'all' 
            ? 'No reports match your filters'
            : 'No reports found'}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedFiltered).map(([category, categoryReports]) => {
            const Icon = categoryIcons[category] || BarChart3;
            return (
              <div key={category} className={`border rounded-lg p-4 ${categoryColors[category]}`}>
                <div className="flex items-center gap-2 mb-4">
                  <Icon className="w-5 h-5" />
                  <h2 className="text-xl font-semibold">{categoryLabels[category]}</h2>
                  <span className="text-sm opacity-75">({categoryReports.length})</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categoryReports.map((report) => (
                    <div
                      key={report.id}
                      className="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">{report.name}</h3>
                          <p className="text-sm text-gray-500 mt-1">{report.route_path}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {report.is_active ? (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          ) : (
                            <XCircle className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                      </div>
                      {report.description && (
                        <p className="text-sm text-gray-600 mb-3">{report.description}</p>
                      )}
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-xs text-gray-500">
                          {report.report_type || 'N/A'}
                        </span>
                        <button
                          onClick={() => handleEdit(report)}
                          className="text-primary-600 hover:text-primary-800 text-sm font-medium flex items-center gap-1"
                        >
                          <Edit2 className="w-4 h-4" />
                          Edit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit/Add Modal */}
      {(showEditModal || showAddModal) && editingReport && (
        <ReportEditModal
          report={editingReport}
          isNew={showAddModal}
          onSave={handleSave}
          onClose={() => {
            setShowEditModal(false);
            setShowAddModal(false);
            setEditingReport(null);
          }}
          saving={saving}
        />
      )}
    </div>
  );
}

function ReportEditModal({
  report,
  isNew,
  onSave,
  onClose,
  saving
}: {
  report: ReportDefinition;
  isNew: boolean;
  onSave: (data: Partial<ReportDefinition>) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [formData, setFormData] = useState<Partial<ReportDefinition>>(report);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(formData);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold mb-4">
          {isNew ? 'Add New Report' : 'Edit Report'}
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Report ID <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.id || ''}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              required
              disabled={!isNew}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100"
              placeholder="e.g., sales_summary"
            />
            <p className="text-xs text-gray-500 mt-1">Unique identifier (cannot be changed)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Report Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.name || ''}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., Sales Summary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Route Path <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData.route_path || ''}
              onChange={(e) => setFormData({ ...formData, route_path: e.target.value })}
              required
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., /reports/sales/summary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.category || 'basic'}
              onChange={(e) => setFormData({ ...formData, category: e.target.value as any })}
              required
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="basic">Basic</option>
              <option value="gst">GST</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Report Type
            </label>
            <input
              type="text"
              value={formData.report_type || ''}
              onChange={(e) => setFormData({ ...formData, report_type: e.target.value || null })}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="e.g., sales, purchase, financial"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value || null })}
              rows={3}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="Brief description of the report"
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active ?? true}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
                Active
              </label>
            </div>

            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sort Order
              </label>
              <input
                type="number"
                value={formData.sort_order || 0}
                onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
