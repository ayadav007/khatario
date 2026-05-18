'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Loader2, ArrowLeft, Trash2, Edit } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';

interface TDSCategory {
  id: string;
  section_code: string;
  section_name: string;
  description?: string;
  rate: number;
  threshold_amount: number;
  created_at: string;
}

export default function TDSCategoriesPage() {
  const router = useRouter();
  const { business } = useAuth();
  const toast = useToastContext();
  const [categories, setCategories] = useState<TDSCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    section_code: '',
    section_name: '',
    description: '',
    rate: '',
    threshold_amount: '0'
  });

  useEffect(() => {
    if (business?.id) {
      fetchCategories();
    }
  }, [business?.id]);

  const fetchCategories = async () => {
    if (!business?.id) return;
    
    setLoading(true);
    try {
      const response = await fetch(`/api/tds/categories?business_id=${business.id}`);
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
      } else {
        toast.error('Failed to load TDS categories');
      }
    } catch (error) {
      console.error('Error fetching TDS categories:', error);
      toast.error('Failed to load TDS categories');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;

    if (!formData.section_code.trim() || !formData.section_name.trim() || !formData.rate) {
      toast.warning('Section code, section name, and rate are required');
      return;
    }

    setSaving(true);
    try {
      const url = editingId 
        ? `/api/tds/categories/${editingId}`
        : '/api/tds/categories';
      
      const method = editingId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          section_code: formData.section_code.trim(),
          section_name: formData.section_name.trim(),
          description: formData.description.trim() || null,
          rate: parseFloat(formData.rate),
          threshold_amount: parseFloat(formData.threshold_amount) || 0
        })
      });

      if (response.ok) {
        toast.success(editingId ? 'Category updated successfully' : 'Category added successfully');
        setFormData({
          section_code: '',
          section_name: '',
          description: '',
          rate: '',
          threshold_amount: '0'
        });
        setShowAddForm(false);
        setEditingId(null);
        fetchCategories();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to save category');
      }
    } catch (error) {
      console.error('Error saving category:', error);
      toast.error('Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (category: TDSCategory) => {
    setFormData({
      section_code: category.section_code,
      section_name: category.section_name,
      description: category.description || '',
      rate: category.rate.toString(),
      threshold_amount: category.threshold_amount.toString()
    });
    setEditingId(category.id);
    setShowAddForm(true);
  };

  const handleDelete = async (categoryId: string) => {
    if (!confirm('Are you sure you want to delete this TDS category?')) {
      return;
    }

    try {
      const response = await fetch(`/api/tds/categories/${categoryId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        toast.success('Category deleted successfully');
        fetchCategories();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error('Failed to delete category');
    }
  };

  const handleCancel = () => {
    setFormData({
      section_code: '',
      section_name: '',
      description: '',
      rate: '',
      threshold_amount: '0'
    });
    setEditingId(null);
    setShowAddForm(false);
  };

  return (
    
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/tds')}
            className="p-2 rounded-lg hover:bg-gray-100 transition"
            title="Back to TDS"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">TDS Categories</h1>
            <p className="text-gray-600 text-sm mt-1">Manage TDS sections and rates</p>
          </div>
        </div>

        {/* Add/Edit Form */}
        <Card padding="lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit Category' : 'Add Category'}
              </h3>
              <p className="text-sm text-gray-600">
                {editingId ? 'Update TDS category details' : 'Create a new TDS category'}
              </p>
            </div>
            <Button onClick={() => setShowAddForm(!showAddForm)} variant={showAddForm ? 'secondary' : 'primary'}>
              <Plus className="w-4 h-4 mr-2" />
              {showAddForm ? 'Close' : 'New Category'}
            </Button>
          </div>

          {showAddForm && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="Section Code *"
                  value={formData.section_code}
                  onChange={(e) => setFormData({ ...formData, section_code: e.target.value })}
                  placeholder="e.g., 194A, 194C"
                  required
                />
                <Input
                  label="Section Name *"
                  value={formData.section_name}
                  onChange={(e) => setFormData({ ...formData, section_name: e.target.value })}
                  placeholder="e.g., Interest on Securities"
                  required
                />
                <Input
                  label="Rate (%) *"
                  type="number"
                  step="0.01"
                  value={formData.rate}
                  onChange={(e) => setFormData({ ...formData, rate: e.target.value })}
                  placeholder="e.g., 10"
                  required
                />
                <Input
                  label="Threshold Amount"
                  type="number"
                  step="0.01"
                  value={formData.threshold_amount}
                  onChange={(e) => setFormData({ ...formData, threshold_amount: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Category' : 'Add Category'}
                </Button>
                <Button type="button" variant="secondary" onClick={handleCancel}>
                  Cancel
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
              <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No TDS categories yet</p>
              <p className="text-sm mt-1">Add a category to manage TDS sections</p>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {categories.map((category) => (
              <Card key={category.id} padding="md" className="hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <FileText className="w-5 h-5 text-primary-600" />
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {category.section_code} - {category.section_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          Rate: {category.rate}% | Threshold: ₹{Number(category.threshold_amount).toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>
                    {category.description && (
                      <p className="text-sm text-gray-600 mb-2">{category.description}</p>
                    )}
                    <p className="text-xs text-gray-500">
                      Created on {new Date(category.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(category)}
                      className="p-2 text-primary-600 hover:bg-slate-50 rounded-lg transition-colors"
                      title="Edit category"
                    >
                      <Edit className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(category.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete category"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    
  );
}

