'use client';

import React, { useState, useEffect } from 'react';
import { getPosMode, setPosMode } from '@/lib/pos-settings';
import { Button } from '@/components/ui/Button';
import { Loader2 } from 'lucide-react';

interface POSModeToggleProps {
  onToggle?: (enabled: boolean) => void;
}

export function POSModeToggle({ onToggle }: POSModeToggleProps) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEnabled(getPosMode());
    setLoading(false);
  }, []);

  const handleToggle = () => {
    const newValue = !enabled;
    setPosMode(newValue);
    setEnabled(newValue);
    onToggle?.(newValue);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium text-gray-700">POS Mode</span>
      <button
        onClick={handleToggle}
        className={`
          relative inline-flex h-6 w-11 items-center rounded-full transition-colors
          ${enabled ? 'bg-primary-600' : 'bg-gray-300'}
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
        `}
        role="switch"
        aria-checked={enabled}
      >
        <span
          className={`
            inline-block h-4 w-4 transform rounded-full bg-white transition-transform
            ${enabled ? 'translate-x-6' : 'translate-x-1'}
          `}
        />
      </button>
      <span className="text-xs text-gray-500">
        {enabled ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}
