'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Plus, Tag, Trash2, Loader2, ArrowLeft } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';

interface Category {
  id: string;
  name: string;
  description?: string;
  item_count: number;
  created_at: string;
}

export default function ItemCategoriesPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState({
    name: '',
    description: ''
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
      const response = await fetch(`/api/categories?business_id=${business.id}&user_id=${user?.id}`);
      if (response.ok) {
        const data = await response.json();
        setCategories(data.categories || []);
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
      const response = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          created_by_user_id: user?.id,
          name: newCategory.name.trim(),
          description: newCategory.description.trim() || null
        })
      });

      if (response.ok) {
        toast.success('Category added successfully');
        setNewCategory({ name: '', description: '' });
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

  const handleDeleteCategory = async (categoryId: string, categoryName: string) => {
    if (!confirm(`Are you sure you want to delete "${categoryName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/categories?id=${categoryId}`, {
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

  return (
    
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Item Categories</h1>
              <p className="text-gray-600 text-sm mt-1">Manage categories for organizing your items</p>
            </div>
          </div>
          <Button
            variant="primary"
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Category
          </Button>
        </div>

        {/* Add Form */}
        {showAddForm && (
          <Card padding="md">
            <h3 className="font-semibold text-gray-900 mb-4">New Category</h3>
            <form onSubmit={handleAddCategory} className="space-y-4">
              <Input
                label="Category Name *"
                value={newCategory.name}
                onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                placeholder="e.g., Electronics, Clothing, Food"
                required
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  value={newCategory.description}
                  onChange={(e) => setNewCategory({ ...newCategory, description: e.target.value })}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" isLoading={saving}>
                  Add Category
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowAddForm(false);
                    setNewCategory({ name: '', description: '' });
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Categories List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
          </div>
        ) : categories.length === 0 ? (
          <Card padding="lg">
            <div className="text-center text-gray-500">
              <Tag className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <p>No categories yet</p>
              <p className="text-sm mt-1">Add a category to organize your items</p>
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
                    <p className="text-xs text-gray-500">
                      {category.item_count} {category.item_count === 1 ? 'item' : 'items'} in this category
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteCategory(category.id, category.name)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete category"
                    disabled={category.item_count > 0}
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                {category.item_count > 0 && (
                  <p className="text-xs text-orange-600 mt-2">
                    Cannot delete: {category.item_count} items assigned to this category
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    
  );
}

