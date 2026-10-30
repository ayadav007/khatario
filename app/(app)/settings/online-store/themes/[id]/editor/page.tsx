'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';
import { readBackup } from '@/lib/store/engine/editor/save-queue';
import { Studio2Editor } from '@/components/store/studio2/Studio2Editor';
import { editorPath, fetchTheme, openWorkingDraft } from '@/components/store/studio2/api';

const NARROW_QUERY = '(max-width: 1023px)';

interface Loaded {
  theme: ThemeRow;
  initialData: ThemeData;
  restored: boolean;
  staleBackup: ThemeData | null;
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
  const narrow = useNarrow();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (narrow !== false || !business?.id || !id) return;
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
        const backup = readBackup(localStore(), theme.id, theme.updated_at);
        setLoaded({
          theme,
          initialData: backup && !backup.stale ? backup.data : theme.data,
          restored: !!backup && !backup.stale,
          staleBackup: backup?.stale ? backup.data : null,
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load theme');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [narrow, business?.id, id, router]);

  if (narrow === null) return null;
  if (narrow) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white p-6 text-center text-sm text-gray-700">
        Open the editor on a laptop or desktop
      </div>
    );
  }
  if (error) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-white p-6 text-sm">
        <p className="text-red-600">{error}</p>
        <Link href="/settings/online-store" className="text-gray-700 underline">
          Back to Online store
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
      userId={user.id}
      theme={loaded.theme}
      initialData={loaded.initialData}
      restored={loaded.restored}
      staleBackup={loaded.staleBackup}
    />
  );
}
