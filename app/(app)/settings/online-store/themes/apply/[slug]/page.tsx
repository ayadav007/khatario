'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Palette } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { usePermissions } from '@/hooks/usePermissions';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { BlankSketch } from '@/components/marketing/themes/ThemeCard';
import { ThemeLivePreview } from '@/components/marketing/themes/ThemeLivePreview';
import { createTheme, editorPath, listThemes } from '@/components/store/library/api';
import { demoStoreUrl } from '@/lib/store/demo-store-url';
import { LIMIT_NOTICE, NO_EDIT_NOTICE, canAddTheme } from '@/lib/store/engine/library';
import { catalogTheme } from '@/lib/store/engine/theme-catalog';
import { themeStorePaths } from '@/lib/store/engine/theme-store';

const PREMIUM_OFF_NOTICE = "Premium themes aren't on for your store yet.";

type State = { kind: 'loading' } | { kind: 'ready'; count: number; premium: boolean } | { kind: 'error'; message: string };

/**
 * Apply theme from the theme store: "Add <Name> to your themes?", then the theme is created in the library (named after
 * itself) and the editor opens. Same checks as the library's Add theme; the API enforces them again.
 */
export default function ApplyThemePage({ params }: { params: { slug: string } }) {
  const theme = catalogTheme(params.slug);
  const router = useRouter();
  const toast = useToastContext();
  const { business, user } = useAuth();
  const { canModify, isPrimaryAdmin, loading: permissionsLoading } = usePermissions();
  const ready = !permissionsLoading && !!user;
  const mayEdit = ready ? canModify('settings') || isPrimaryAdmin : null;
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (theme?.demo) {
      setPreview(demoStoreUrl(window.location.host, window.location.protocol, theme.demo.subdomain, '/', true));
    }
  }, [theme]);

  useEffect(() => {
    if (mayEdit !== true || !business?.id) return;
    let cancelled = false;
    listThemes()
      .then((r) => !cancelled && setState({ kind: 'ready', count: r.themes.length, premium: r.premium_enabled }))
      .catch((e: unknown) => !cancelled && setState({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load themes' }));
    return () => {
      cancelled = true;
    };
  }, [mayEdit, business?.id]);

  const shell = (body: React.ReactNode) => (
    <SettingsPageShell title={theme ? `Apply ${theme.name}` : 'Apply theme'} icon={Palette}>
      {body}
    </SettingsPageShell>
  );
  const note = (text: string) => (
    <div className="space-y-4">
      <div role="note" className="rounded-lg border border-border bg-gray-50 dark:bg-slate-800/50 px-4 py-3 text-sm text-text-secondary">
        {text}
      </div>
      <Link href={themeStorePaths(true).store} className="text-sm text-text-secondary underline">
        Back to themes
      </Link>
    </div>
  );

  if (!theme) return shell(note("This theme doesn't exist."));
  if (mayEdit === false) return shell(note(NO_EDIT_NOTICE));
  if (mayEdit === null || state.kind === 'loading') {
    return shell(
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </div>,
    );
  }
  if (state.kind === 'error') return shell(note(state.message));
  if (theme.premium && !state.premium) return shell(note(PREMIUM_OFF_NOTICE));
  if (!canAddTheme(state.count)) return shell(note(LIMIT_NOTICE));

  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await createTheme({ preset: theme.preset });
      router.push(editorPath(created.id));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Failed to add the theme');
      setBusy(false);
    }
  };

  return shell(
    <div className="max-w-3xl space-y-5">
      <p className="text-base text-text-primary">
        Add <strong>{theme.demo ? theme.name : 'a blank theme'}</strong> to your themes? It opens in the editor, filled with your
        store&apos;s name; your live store doesn&apos;t change until you publish.
      </p>
      <div className="overflow-hidden rounded-xl border border-border">
        {theme.demo && preview ? (
          <ThemeLivePreview src={preview} width={1440} height={900} interactive={false} palette={theme.palette} title={`${theme.name} demo store`} />
        ) : (
          <BlankSketch />
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Add and customise
        </button>
        <Link href={themeStorePaths(true).store} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary hover:bg-gray-50 dark:hover:bg-slate-800/60">
          Back to themes
        </Link>
      </div>
    </div>,
  );
}
