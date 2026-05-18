'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { CheckCircle, Loader2, ArrowLeft, Plus, Filter, Download } from 'lucide-react';
import { format } from 'date-fns';
import { useToastContext } from '@/contexts/ToastContext';

interface TDSCertificate {
  id: string;
  supplier_id: string;
  supplier_name?: string;
  supplier_gstin?: string;
  financial_year: string;
  quarter: string;
  certificate_number: string;
  issue_date: string;
  total_tds_amount: number;
  is_issued: boolean;
  issued_date?: string;
  created_at: string;
}

export default function TDSCertificatesPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [certificates, setCertificates] = useState<TDSCertificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({
    financial_year: '',
    quarter: '',
    supplier_id: ''
  });
  const [formData, setFormData] = useState({
    supplier_id: '',
    financial_year: '',
    quarter: '',
    issue_date: ''
  });
  const [suppliers, setSuppliers] = useState<any[]>([]);

  useEffect(() => {
    if (business?.id) {
      fetchCertificates();
      fetchSuppliers();
    }
  }, [business?.id, filters]);

  const fetchCertificates = async () => {
    if (!business?.id) return;
    
    setLoading(true);
    try {
      const params = new URLSearchParams({ business_id: business.id });
      if (filters.financial_year) params.append('financial_year', filters.financial_year);
      if (filters.quarter) params.append('quarter', filters.quarter);
      if (filters.supplier_id) params.append('supplier_id', filters.supplier_id);

      const response = await fetch(`/api/tds/certificates?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setCertificates(data.certificates || []);
      } else {
        toast.error('Failed to load TDS certificates');
      }
    } catch (error) {
      console.error('Error fetching TDS certificates:', error);
      toast.error('Failed to load TDS certificates');
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    if (!business?.id) return;
    try {
      const response = await fetch(`/api/suppliers?business_id=${business.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        setSuppliers(data.suppliers || []);
      }
    } catch (error) {
      console.error('Error fetching suppliers:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    if (!formData.supplier_id || !formData.financial_year || !formData.quarter || !formData.issue_date) {
      toast.warning('Please fill all required fields');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/tds/certificates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          supplier_id: formData.supplier_id,
          financial_year: formData.financial_year,
          quarter: formData.quarter,
          issue_date: formData.issue_date
        })
      });

      if (response.ok) {
        toast.success('TDS certificate generated successfully');
        setFormData({
          supplier_id: '',
          financial_year: '',
          quarter: '',
          issue_date: ''
        });
        setShowAddForm(false);
        fetchCertificates();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to generate certificate');
      }
    } catch (error) {
      console.error('Error generating certificate:', error);
      toast.error('Failed to generate certificate');
    } finally {
      setSaving(false);
    }
  };

  const currentYear = new Date().getFullYear();
  const financialYears = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];

  return (
    
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/tds')}
              className="p-2 rounded-lg hover:bg-gray-100 transition"
              title="Back to TDS"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">TDS Certificates</h1>
              <p className="text-gray-600 text-sm mt-1">Generate Form 16A certificates</p>
            </div>
          </div>
          <Button onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? 'secondary' : 'primary'}>
            <Plus className="w-4 h-4 mr-2" />
            {showAddForm ? 'Close' : 'Generate Certificate'}
          </Button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <Card padding="lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Generate TDS Certificate</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Supplier *</label>
                  <select
                    value={formData.supplier_id}
                    onChange={(e) => setFormData({ ...formData, supplier_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  >
                    <option value="">Select Supplier</option>
                    {suppliers.map(supplier => (
                      <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year *</label>
                  <select
                    value={formData.financial_year}
                    onChange={(e) => setFormData({ ...formData, financial_year: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  >
                    <option value="">Select Year</option>
                    {financialYears.map(year => (
                      <option key={year} value={year}>{year}-{year + 1}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quarter *</label>
                  <select
                    value={formData.quarter}
                    onChange={(e) => setFormData({ ...formData, quarter: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
                    required
                  >
                    <option value="">Select Quarter</option>
                    {quarters.map(q => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Issue Date *"
                  type="date"
                  value={formData.issue_date}
                  onChange={(e) => setFormData({ ...formData, issue_date: e.target.value })}
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Generating...' : 'Generate Certificate'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Filters */}
        <Card padding="md">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-gray-600" />
            <h3 className="font-semibold text-gray-900">Filters</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Financial Year</label>
              <select
                value={filters.financial_year}
                onChange={(e) => setFilters({ ...filters, financial_year: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Years</option>
                {financialYears.map(year => (
                  <option key={year} value={year}>{year}-{year + 1}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Quarter</label>
              <select
                value={filters.quarter}
                onChange={(e) => setFilters({ ...filters, quarter: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Quarters</option>
                {quarters.map(q => (
                  <option key={q} value={q}>{q}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Supplier</label>
              <select
                value={filters.supplier_id}
                onChange={(e) => setFilters({ ...filters, supplier_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">All Suppliers</option>
                {suppliers.map(supplier => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button
                variant="secondary"
                onClick={() => setFilters({ financial_year: '', quarter: '', supplier_id: '' })}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </Card>

        {/* Certificates List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : certificates.length === 0 ? (
          <Card padding="lg">
            <div className="text-center text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No TDS certificates generated</p>
              <p className="text-sm mt-1">Generate a certificate to get started</p>
            </div>
          </Card>
        ) : (
          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Certificate Number</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issue Date</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">TDS Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">FY/Quarter</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {certificates.map((certificate) => (
                    <tr key={certificate.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {certificate.certificate_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div>
                          <div className="font-medium">{certificate.supplier_name || 'N/A'}</div>
                          {certificate.supplier_gstin && (
                            <div className="text-xs text-gray-500">GSTIN: {certificate.supplier_gstin}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {format(new Date(certificate.issue_date), 'dd MMM yyyy')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-semibold text-gray-900">
                        ₹{Number(certificate.total_tds_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {certificate.financial_year} {certificate.quarter}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {certificate.is_issued ? (
                          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                            Issued
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">
                            Draft
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/tds/certificates/${certificate.id}/pdf`);
                              if (!res.ok) throw new Error('Failed to generate PDF');
                              const blob = await res.blob();
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `TDS-Certificate-${certificate.certificate_number}.pdf`;
                              document.body.appendChild(a);
                              a.click();
                              a.remove();
                            } catch (error) {
                              console.error('Download error:', error);
                              toast.error('Failed to download certificate');
                            }
                          }}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                Total: {certificates.length} certificate{certificates.length !== 1 ? 's' : ''}
              </p>
            </div>
          </Card>
        )}
      </div>
    
  );
}

