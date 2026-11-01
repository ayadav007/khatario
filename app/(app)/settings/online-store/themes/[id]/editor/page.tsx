'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';
import { backupOnOpen, readBackup, sweepBackups } from '@/lib/store/engine/editor/save-queue';
import { Studio2Editor } from '@/components/store/studio2/Studio2Editor';
import { ThemeGoneError, editorPath, fetchTheme, openWorkingDraft } from '@/components/store/studio2/api';
import { LIBRARY_PATH } from '@/lib/store/engine/library';

const NARROW_QUERY = '(max-width: 1023px)';
const GONE_TEXT = 'This theme no longer exists.';
/** Final review M1: its edits were kept when the move to the working copy failed; the library moves them there. */
const GONE_EDITS_TEXT =
  'This theme no longer exists. Your unsaved changes from it are kept on this device: open Themes, then your working copy, to keep or discard them.';

interface Loaded {
  theme: ThemeRow;
  initialData: ThemeData;
  restored: boolean;
  carriedBackup: ThemeData | null;
  droppedBackup: boolean;
}

function useNarrow(): boolean | null {
  const [narrow, setNarrow] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

function localStore(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function Studio2EditorPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();
  const { business, user } = useAuth();
  const { canModify, isPrimaryAdmin, loading: permissionsLoading } = usePermissions();
  // Same rule as the theme writes (settings:update): without it nothing would save. The theme GETs accept
  // update as well as read (final review M2). No user yet means permissions are still loading too (N1).
  const canEdit = permissionsLoading || !user ? null : canModify('settings') || isPrimaryAdmin;
  const narrow = useNarrow();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (narrow !== false || canEdit !== true || !business?.id || !id) return;
    let cancelled = false;
    setLoaded(null);
    setError(null);
    (async () => {
      try {
        const theme = await fetchTheme(business.id, id);
        if (cancelled) return;
        if (theme.role === 'live') {
          const draft = await openWorkingDraft(business.id);
          if (!cancelled) router.replace(editorPath(draft.id));
          return;
        }
        const storage = localStore();
        sweepBackups(storage, business.id, { now: Date.now() });
        // Final review I2: a backup made on an older copy is dropped, never offered (see BackupKind).
        const open = backupOnOpen(storage, business.id, theme);
        setLoaded({
          theme,
          initialData: open.initialData,
          restored: open.restored,
          carriedBackup: open.carried,
          droppedBackup: open.dropped,
        });
      } catch (e) {
        if (cancelled) return;
        // D50: a deleted theme (or a stale link) says so plainly; the link below goes back to the library.
        if (e instanceof ThemeGoneError) {
          const kept = readBackup(localStore(), business.id, id, '')?.gone === true;
          setError(kept ? GONE_EDITS_TEXT : GONE_TEXT);
        } else setError(e instanceof Error && e.message ? e.message : 'Failed to load theme');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [narrow, canEdit, business?.id, id, router]);

  if (narrow === null) return null;
  if (narrow) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white p-6 text-center text-sm text-gray-700">
        Open the editor on a laptop or desktop
      </div>
    );
  }
  if (canEdit === false) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-white p-6 text-center text-sm">
        <p className="text-gray-700">You can&apos;t edit the store design: changing it needs permission to update settings.</p>
        <p className="text-gray-500">Ask an admin for that permission.</p>
        <Link href={LIBRARY_PATH} className="text-gray-700 underline">
          Back to themes
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-white p-6 text-sm">
        <p className="text-red-600">{error}</p>
        <Link href={LIBRARY_PATH} className="text-gray-700 underline">
          Back to themes
        </Link>
      </div>
    );
  }
  if (!loaded || !business?.id || !user?.id) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  return (
    <Studio2Editor
      key={loaded.theme.id}
      businessId={business.id}
      theme={loaded.theme}
      initialData={loaded.initialData}
      restored={loaded.restored}
      carriedBackup={loaded.carriedBackup}
      droppedBackup={loaded.droppedBackup}
    />
  );
}
