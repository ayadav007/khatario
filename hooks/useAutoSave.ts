'use client';

import { useEffect, useRef, useCallback } from 'react';

interface AutoSaveOptions {
  enabled?: boolean;
  interval?: number; // milliseconds
  onSave: () => void;
  onSaved?: () => void;
  storageKey?: string;
}

/**
 * Auto-save hook for forms
 * Saves form data to localStorage at regular intervals
 */
export function useAutoSave<T extends Record<string, any>>(
  formData: T,
  options: AutoSaveOptions
) {
  const {
    enabled = true,
    interval = 30000, // 30 seconds default
    onSave,
    onSaved,
    storageKey,
  } = options;

  const lastSavedRef = useRef<string>('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);

  const saveToStorage = useCallback((data: T) => {
    if (!storageKey || typeof window === 'undefined') return;
    
    try {
      const serialized = JSON.stringify(data);
      localStorage.setItem(`draft_${storageKey}`, serialized);
      localStorage.setItem(`draft_${storageKey}_timestamp`, new Date().toISOString());
    } catch (error) {
      console.error('Failed to save draft:', error);
    }
  }, [storageKey]);

  const loadFromStorage = useCallback((): T | null => {
    if (!storageKey || typeof window === 'undefined') return null;
    
    try {
      const stored = localStorage.getItem(`draft_${storageKey}`);
      if (stored) {
        return JSON.parse(stored) as T;
      }
    } catch (error) {
      console.error('Failed to load draft:', error);
    }
    return null;
  }, [storageKey]);

  const performAutoSave = useCallback(() => {
    if (!enabled || isSavingRef.current) return;

    const currentData = JSON.stringify(formData);
    
    if (currentData === lastSavedRef.current) return;

    isSavingRef.current = true;
    
    try {
      saveToStorage(formData);
      onSave();
      lastSavedRef.current = currentData;
      onSaved?.();
    } catch (error) {
      console.error('Auto-save failed:', error);
    } finally {
      isSavingRef.current = false;
    }
  }, [formData, enabled, onSave, onSaved, saveToStorage]);

  useEffect(() => {
    if (!enabled) return;

    const initialTimer = setTimeout(() => {
      performAutoSave();
    }, 1000);

    intervalRef.current = setInterval(performAutoSave, interval);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [enabled, interval, performAutoSave]);

  useEffect(() => {
    return () => {
      if (enabled) {
        performAutoSave();
      }
    };
  }, [enabled, performAutoSave]);

  return {
    loadFromStorage,
    saveToStorage: performAutoSave,
    isFeatureEnabled: true,
  };
}
