'use client';

import React, { useState, useEffect } from 'react';
import { 
  Filter, X, Plus, Save, Star, Trash2, ChevronDown, ChevronUp 
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';


export interface FilterCriteria {
  id: string;
  field: string;
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'startsWith' | 'endsWith' | 'in' | 'between';
  value: any;
  label?: string;
}

export interface FilterPreset {
  id?: string;
  name: string;
  description?: string;
  filters: FilterCriteria[];
  isPublic?: boolean;
  isDefault?: boolean;
}

interface AdvancedFilterPanelProps {
  entityType: string;
  businessId: string;
  availableFields: Array<{
    field: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select' | 'boolean';
    options?: Array<{ value: string; label: string }>;
  }>;
  onFiltersChange: (filters: FilterCriteria[]) => void;
  currentFilters?: FilterCriteria[];
}

const OPERATORS = {
  text: [
    { value: 'eq', label: 'Equals' },
    { value: 'ne', label: 'Not Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'startsWith', label: 'Starts With' },
    { value: 'endsWith', label: 'Ends With' },
  ],
  number: [
    { value: 'eq', label: 'Equals' },
    { value: 'ne', label: 'Not Equals' },
    { value: 'gt', label: 'Greater Than' },
    { value: 'lt', label: 'Less Than' },
    { value: 'gte', label: 'Greater Than or Equal' },
    { value: 'lte', label: 'Less Than or Equal' },
    { value: 'between', label: 'Between' },
  ],
  date: [
    { value: 'eq', label: 'On' },
    { value: 'gt', label: 'After' },
    { value: 'lt', label: 'Before' },
    { value: 'between', label: 'Between' },
  ],
  select: [
    { value: 'eq', label: 'Is' },
    { value: 'ne', label: 'Is Not' },
    { value: 'in', label: 'In' },
  ],
  boolean: [
    { value: 'eq', label: 'Is' },
  ],
};

export const AdvancedFilterPanel: React.FC<AdvancedFilterPanelProps> = ({
  entityType,
  businessId,
  availableFields,
  onFiltersChange,
  currentFilters = [],
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterCriteria[]>(currentFilters);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load saved presets
  useEffect(() => {
    if (businessId) {
      loadPresets();
    }
  }, [businessId, entityType]);

  const loadPresets = async () => {
    try {
      const response = await fetch(
        `/api/filters/presets?business_id=${businessId}&entity_type=${entityType}`
      );
      if (response.ok) {
        const data = await response.json();
        setPresets(data.presets || []);
        
        // Apply default preset if exists
        const defaultPreset = data.presets?.find((p: FilterPreset) => p.isDefault);
        if (defaultPreset && filters.length === 0) {
          setFilters(defaultPreset.filters);
          onFiltersChange(defaultPreset.filters);
        }
      }
    } catch (error) {
      console.error('Failed to load filter presets:', error);
    }
  };

  const addFilter = () => {
    const newFilter: FilterCriteria = {
      id: `filter-${Date.now()}`,
      field: availableFields[0]?.field || '',
      operator: 'eq',
      value: '',
    };
    const updated = [...filters, newFilter];
    setFilters(updated);
  };

  const updateFilter = (id: string, updates: Partial<FilterCriteria>) => {
    const updated = filters.map(f => 
      f.id === id ? { ...f, ...updates } : f
    );
    setFilters(updated);
  };

  const removeFilter = (id: string) => {
    const updated = filters.filter(f => f.id !== id);
    setFilters(updated);
    onFiltersChange(updated);
  };

  const applyFilters = () => {
    onFiltersChange(filters);
    setIsOpen(false);
  };

  const clearFilters = () => {
    setFilters([]);
    onFiltersChange([]);
  };

  const savePreset = async () => {
    if (!presetName.trim()) return;

    setLoading(true);
    try {
      const response = await fetch('/api/filters/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: businessId,
          name: presetName,
          description: presetDescription,
          entity_type: entityType,
          filters,
          is_public: isPublic,
          is_default: isDefault,
        }),
      });

      if (response.ok) {
        setShowSaveModal(false);
        setPresetName('');
        setPresetDescription('');
        setIsPublic(false);
        setIsDefault(false);
        loadPresets();
      }
    } catch (error) {
      console.error('Failed to save preset:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadPreset = (preset: FilterPreset) => {
    setFilters(preset.filters);
    onFiltersChange(preset.filters);
    setIsOpen(false);
  };

  const deletePreset = async (presetId: string) => {
    if (!confirm('Delete this filter preset?')) return;

    try {
      const response = await fetch(`/api/filters/presets/${presetId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        loadPresets();
      }
    } catch (error) {
      console.error('Failed to delete preset:', error);
    }
  };

  const getOperatorsForField = (fieldName: string) => {
    const field = availableFields.find(f => f.field === fieldName);
    return field ? OPERATORS[field.type] : OPERATORS.text;
  };

  const getFieldType = (fieldName: string) => {
    return availableFields.find(f => f.field === fieldName)?.type || 'text';
  };

  const getFieldOptions = (fieldName: string) => {
    return availableFields.find(f => f.field === fieldName)?.options || [];
  };

  const activeFilterCount = filters.filter(f => f.value).length;

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center gap-2 px-4 py-2 rounded-lg border transition-all
          ${activeFilterCount > 0 
            ? 'bg-primary-500 text-white border-primary-600 hover:bg-primary-600' 
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
          }
        `}
      >
        <Filter className="w-4 h-4" />
        <span className="font-medium">Filters</span>
        {activeFilterCount > 0 && (
          <span className="bg-white text-primary-600 px-2 py-0.5 rounded-full text-xs font-bold">
            {activeFilterCount}
          </span>
        )}
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Filter Panel */}
      {isOpen && (
        <Card className="absolute top-12 right-0 w-[600px] max-w-[90vw] z-50 shadow-large dark:bg-gray-800 dark:border-gray-700">
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b pb-3 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-primary-500" />
                <h3 className="font-semibold text-lg dark:text-gray-100">Advanced Filters</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-5 h-5 dark:text-gray-400" />
              </button>
            </div>

            {/* Saved Presets */}
            {presets.length > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Saved Filters
                </label>
                <div className="flex flex-wrap gap-2">
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => loadPreset(preset)}
                      className="group flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-slate-50 dark:hover:bg-primary-900 rounded-lg border border-gray-200 dark:border-gray-600 transition-all"
                    >
                      {preset.isDefault && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />}
                      <span className="text-sm font-medium dark:text-gray-200">{preset.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePreset(preset.id!);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 dark:hover:bg-red-900 rounded"
                      >
                        <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                      </button>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Filter Criteria */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {filters.map((filter, index) => {
                const fieldType = getFieldType(filter.field);
                const operators = getOperatorsForField(filter.field);
                const options = getFieldOptions(filter.field);

                return (
                  <div key={filter.id} className="flex items-start gap-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
                    {/* Field Selector */}
                    <select
                      value={filter.field}
                      onChange={(e) => updateFilter(filter.id, { field: e.target.value })}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200"
                    >
                      {availableFields.map((field) => (
                        <option key={field.field} value={field.field}>
                          {field.label}
                        </option>
                      ))}
                    </select>

                    {/* Operator Selector */}
                    <select
                      value={filter.operator}
                      onChange={(e) => updateFilter(filter.id, { operator: e.target.value as any })}
                      className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200"
                    >
                      {operators.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>

                    {/* Value Input */}
                    {fieldType === 'select' ? (
                      <select
                        value={filter.value}
                        onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200"
                      >
                        <option value="">Select...</option>
                        {options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : fieldType === 'boolean' ? (
                      <select
                        value={filter.value}
                        onChange={(e) => updateFilter(filter.id, { value: e.target.value === 'true' })}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200"
                      >
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <input
                        type={fieldType === 'number' ? 'number' : fieldType === 'date' ? 'date' : 'text'}
                        value={filter.value}
                        onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                        placeholder="Value..."
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 dark:text-gray-200"
                      />
                    )}

                    {/* Remove Button */}
                    <button
                      onClick={() => removeFilter(filter.id)}
                      className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900 rounded-lg"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}

              {/* Add Filter Button */}
              <button
                onClick={addFilter}
                className="w-full py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:border-primary-500 hover:text-primary-500 dark:hover:border-primary-400 dark:hover:text-primary-400 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span className="font-medium">Add Filter</span>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between border-t pt-3 dark:border-gray-700">
              <div className="flex gap-2">
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-all"
                >
                  Clear All
                </button>
                <button
                  onClick={() => setShowSaveModal(true)}
                  disabled={filters.length === 0}
                  className="flex items-center gap-2 px-4 py-2 text-primary-600 dark:text-primary-400 hover:bg-slate-50 dark:hover:bg-primary-900 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" />
                  <span>Save Preset</span>
                </button>
              </div>
              <Button onClick={applyFilters} disabled={filters.length === 0}>
                Apply Filters
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Save Preset Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <Card className="w-[500px] max-w-[90vw] dark:bg-gray-800 dark:border-gray-700">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold dark:text-gray-100">Save Filter Preset</h3>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Preset Name *
                </label>
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="e.g., Paid Invoices This Month"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-gray-200"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={presetDescription}
                  onChange={(e) => setPresetDescription(e.target.value)}
                  placeholder="Optional description..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 dark:text-gray-200"
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Share with team</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Set as default</span>
                </label>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowSaveModal(false)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <Button onClick={savePreset} disabled={!presetName.trim() || loading}>
                  {loading ? 'Saving...' : 'Save Preset'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};
