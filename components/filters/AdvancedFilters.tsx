'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Filter, X, Save, Calendar, DollarSign, User, Package } from 'lucide-react';


export interface FilterCriteria {
  field: string;
  operator: 'equals' | 'contains' | 'greater_than' | 'less_than' | 'between' | 'in';
  value: string | number | string[];
}

export interface SavedFilter {
  id: string;
  name: string;
  criteria: FilterCriteria[];
}

interface AdvancedFiltersProps {
  fields: Array<{ key: string; label: string; type: 'text' | 'number' | 'date' | 'select' }>;
  onApply: (criteria: FilterCriteria[]) => void;
  onReset: () => void;
  savedFilters?: SavedFilter[];
  onSaveFilter?: (name: string, criteria: FilterCriteria[]) => void;
}

export const AdvancedFilters: React.FC<AdvancedFiltersProps> = ({
  fields,
  onApply,
  onReset,
  savedFilters = [],
  onSaveFilter,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [criteria, setCriteria] = useState<FilterCriteria[]>([]);
  const [filterName, setFilterName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const addCriterion = () => {
    setCriteria([
      ...criteria,
      { field: fields[0]?.key || '', operator: 'equals', value: '' },
    ]);
  };

  const removeCriterion = (index: number) => {
    setCriteria(criteria.filter((_, i) => i !== index));
  };

  const updateCriterion = (index: number, updates: Partial<FilterCriteria>) => {
    setCriteria(
      criteria.map((c, i) => (i === index ? { ...c, ...updates } : c))
    );
  };

  const handleApply = () => {
    onApply(criteria);
    setIsOpen(false);
  };

  const handleSave = () => {
    if (filterName && onSaveFilter) {
      onSaveFilter(filterName, criteria);
      setFilterName('');
      setShowSaveDialog(false);
    }
  };

  const loadSavedFilter = (filter: SavedFilter) => {
    setCriteria(filter.criteria);
  };

  if (!isOpen) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2"
      >
        <Filter className="w-4 h-4" />
        <span>Advanced Filters</span>
        {criteria.length > 0 && (
          <span className="px-2 py-0.5 bg-primary-500 text-white text-xs rounded-full">
            {criteria.length}
          </span>
        )}
      </Button>
    );
  }

  return (
    <Card padding="md" className="absolute z-50 w-full max-w-2xl mt-2 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Advanced Filters</h3>
        <button
          onClick={() => setIsOpen(false)}
          className="p-1 hover:bg-gray-100 rounded transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Saved Filters */}
      {savedFilters.length > 0 && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium text-gray-700 mb-2">Saved Filters:</p>
          <div className="flex flex-wrap gap-2">
            {savedFilters.map((filter) => (
              <button
                key={filter.id}
                onClick={() => loadSavedFilter(filter)}
                className="px-3 py-1 text-sm bg-white border border-gray-300 rounded-md hover:bg-gray-50"
              >
                {filter.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter Criteria */}
      <div className="space-y-3 mb-4">
        {criteria.map((criterion, index) => {
          const field = fields.find((f) => f.key === criterion.field);
          return (
            <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <select
                value={criterion.field}
                onChange={(e) => updateCriterion(index, { field: e.target.value })}
                className="flex-1 text-sm border border-gray-300 rounded-md px-3 py-2"
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>

              <select
                value={criterion.operator}
                onChange={(e) =>
                  updateCriterion(index, { operator: e.target.value as any })
                }
                className="w-32 text-sm border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="equals">Equals</option>
                <option value="contains">Contains</option>
                <option value="greater_than">Greater than</option>
                <option value="less_than">Less than</option>
                <option value="between">Between</option>
                <option value="in">In</option>
              </select>

              {field?.type === 'text' && (
                <Input
                  value={criterion.value as string}
                  onChange={(e) => updateCriterion(index, { value: e.target.value })}
                  placeholder="Enter value"
                  className="flex-1"
                />
              )}

              {field?.type === 'number' && (
                <Input
                  type="number"
                  value={criterion.value as number}
                  onChange={(e) =>
                    updateCriterion(index, { value: parseFloat(e.target.value) || 0 })
                  }
                  placeholder="Enter value"
                  className="flex-1"
                />
              )}

              {field?.type === 'date' && (
                <Input
                  type="date"
                  value={criterion.value as string}
                  onChange={(e) => updateCriterion(index, { value: e.target.value })}
                  className="flex-1"
                />
              )}

              <button
                onClick={() => removeCriterion(index)}
                className="p-2 hover:bg-red-50 text-red-600 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}

        <Button variant="ghost" onClick={addCriterion} className="w-full">
          + Add Filter
        </Button>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-200">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onReset} size="sm">
            Reset
          </Button>
          {onSaveFilter && (
            <Button
              variant="ghost"
              onClick={() => setShowSaveDialog(true)}
              size="sm"
              className="flex items-center gap-1"
            >
              <Save className="w-4 h-4" />
              Save
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setIsOpen(false)} size="sm">
            Cancel
          </Button>
          <Button onClick={handleApply} size="sm">
            Apply Filters
          </Button>
        </div>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-primary-200">
          <Input
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="Filter name"
            className="mb-2"
          />
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} size="sm" disabled={!filterName}>
              Save
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowSaveDialog(false);
                setFilterName('');
              }}
              size="sm"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

