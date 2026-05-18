'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Plus, Loader2, Edit, Trash2, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { JournalEntryTemplate } from '@/types/journal-entries';
import Link from 'next/link';
import { useToastContext } from '@/contexts/ToastContext';

export default function JournalEntryTemplatesPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [templates, setTemplates] = useState<JournalEntryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (business?.id) {
      fetchTemplates();
    }
  }, [business?.id]);

  const fetchTemplates = async () => {
    if (!business?.id) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/journal-entries/templates?business_id=${business.id}&is_active=true`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!business?.id || !confirm('Are you sure you want to delete this template?')) return;

    try {
      const res = await fetch(`/api/journal-entries/templates/${templateId}?business_id=${business.id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        await fetchTemplates();
      } else {
        const errorData = await res.json();
        toast.error(errorData.error || 'Failed to delete template');
      }
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    }
  };

  const filteredTemplates = templates.filter(template => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      template.name?.toLowerCase().includes(searchLower) ||
      template.description?.toLowerCase().includes(searchLower)
    );
  });

  if (loading) {
    return (
      
        <div className="flex items-center justify-center h-[calc(100vh-100px)]">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      
    );
  }

  return (
    
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Journal Entry Templates</h1>
            <p className="text-sm text-text-secondary mt-1">Create reusable templates for recurring entries</p>
          </div>
          <Link href="/journal-entries/templates/new">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Template
            </Button>
          </Link>
        </div>

        <Card>
          <div className="mb-4">
            <Input
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md"
            />
          </div>

          {filteredTemplates.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No templates found</p>
              <Link href="/journal-entries/templates/new">
                <Button variant="secondary" className="mt-4">
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Template
                </Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="p-4 border border-border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-text-primary">{template.name}</h3>
                        {!template.is_active && (
                          <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">Inactive</span>
                        )}
                      </div>
                      {template.description && (
                        <p className="text-sm text-text-secondary mt-1">{template.description}</p>
                      )}
                      <div className="mt-2 flex items-center gap-4 text-sm text-text-secondary">
                        <span>{Array.isArray(template.lines) ? template.lines.length : 0} lines</span>
                        {template.entry_date_offset !== 0 && (
                          <span>
                            Date offset: {template.entry_date_offset > 0 ? '+' : ''}
                            {template.entry_date_offset} days
                          </span>
                        )}
                        {template.tags && template.tags.length > 0 && (
                          <div className="flex items-center gap-1">
                            {template.tags.map((tag, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-slate-100 text-primary-800 rounded text-xs">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/journal-entries/templates/${template.id}/edit`}>
                        <Button variant="secondary" size="sm">
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </Button>
                      </Link>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDelete(template.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    
  );
}

