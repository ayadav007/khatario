'use client';

import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useDarkMode } from '@/contexts/DarkModeContext';


interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ 
  className = '', 
  showLabel = false 
}) => {
  const { isDarkMode, toggleDarkMode } = useDarkMode();

  return (
    <button
      onClick={toggleDarkMode}
      className={`
        flex items-center gap-2 p-2 rounded-lg
        transition-all duration-200
        hover:bg-gray-100 dark:hover:bg-gray-700
        dark:text-gray-200
        ${className}
      `}
      aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
      title={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
    >
      {isDarkMode ? (
        <>
          <Sun className="w-5 h-5 text-yellow-400" />
          {showLabel && <span className="text-sm font-medium text-text-primary">Light Mode</span>}
        </>
      ) : (
        <>
          <Moon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          {showLabel && <span className="text-sm font-medium text-text-primary">Dark Mode</span>}
        </>
      )}
    </button>
  );
};
