'use client';

import React from 'react';

interface SelectableTableRowProps {
  id: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  className?: string;
}

export const SelectableTableRow: React.FC<SelectableTableRowProps> = ({
  id,
  isSelected,
  onToggle,
  children,
  className = '',
}) => {
  return (
    <tr
      className={`
        transition-colors
        ${isSelected ? 'bg-slate-50 dark:bg-primary-900 dark:bg-opacity-20' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}
        ${className}
      `}
    >
      <td className="px-4 py-3 w-12">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(id)}
          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-800"
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      
      {children}
    </tr>
  );
};

interface SelectableTableHeaderProps {
  isAllSelected: boolean;
  isIndeterminate: boolean;
  onToggleAll: () => void;
  children: React.ReactNode;
}

export const SelectableTableHeader: React.FC<SelectableTableHeaderProps> = ({
  isAllSelected,
  isIndeterminate,
  onToggleAll,
  children,
}) => {
  return (
    <tr>
      <th className="px-4 py-3 w-12 bg-gray-50 dark:bg-gray-800">
        <input
          type="checkbox"
          checked={isAllSelected}
          ref={(el) => {
            if (el) el.indeterminate = isIndeterminate;
          }}
          onChange={onToggleAll}
          className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-700"
        />
      </th>
      
      {children}
    </tr>
  );
};
