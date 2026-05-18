/**
 * Draft Storage Utilities
 * Manages form drafts in localStorage
 */

export interface DraftMetadata {
  timestamp: string;
  formType: string;
  title?: string;
}

/**
 * Save a draft to localStorage
 */
export function saveDraft<T>(key: string, data: T, metadata?: DraftMetadata): void {
  if (typeof window === 'undefined') return;

  try {
    const draft = {
      data,
      metadata: {
        timestamp: new Date().toISOString(),
        ...metadata,
      },
    };
    localStorage.setItem(`draft_${key}`, JSON.stringify(draft));
  } catch (error) {
    console.error('Failed to save draft:', error);
  }
}

/**
 * Load a draft from localStorage
 */
export function loadDraft<T>(key: string): { data: T; metadata: DraftMetadata } | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(`draft_${key}`);
    if (stored) {
      return JSON.parse(stored) as { data: T; metadata: DraftMetadata };
    }
  } catch (error) {
    console.error('Failed to load draft:', error);
  }
  return null;
}

/**
 * Delete a draft
 */
export function deleteDraft(key: string): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(`draft_${key}`);
    localStorage.removeItem(`draft_${key}_timestamp`);
  } catch (error) {
    console.error('Failed to delete draft:', error);
  }
}

/**
 * List all drafts
 */
export function listDrafts(): Array<{ key: string; metadata: DraftMetadata }> {
  if (typeof window === 'undefined') return [];

  const drafts: Array<{ key: string; metadata: DraftMetadata }> = [];

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey?.startsWith('draft_') && !storageKey.endsWith('_timestamp')) {
        const draft = loadDraft(storageKey.replace('draft_', ''));
        if (draft) {
          drafts.push({
            key: storageKey.replace('draft_', ''),
            metadata: draft.metadata,
          });
        }
      }
    }
  } catch (error) {
    console.error('Failed to list drafts:', error);
  }

  return drafts.sort((a, b) => 
    new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime()
  );
}

/**
 * Clear all drafts
 */
export function clearAllDrafts(): void {
  if (typeof window === 'undefined') return;

  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('draft_')) {
        keys.push(key);
      }
    }
    keys.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear drafts:', error);
  }
}

