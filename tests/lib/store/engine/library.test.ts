import {
  ACTION_LABELS,
  DISCARD_CONFIRM,
  ENGINE_OFF_NOTICE,
  MIGRATED_CHOICE,
  MENU_ACTIONS,
  PREVIEW_COPIED,
  checkThemeName,
  customiseOpensWorkingDraft,
  deleteConfirmText,
  presetLabel,
  publishConfirmText,
  themeCountLabel,
  PRESET_CHOICES,
  authorLabel,
  canAddTheme,
  formatPublishedAt,
  relativeEdited,
  splitLibrary,
  themeActions,
} from '@/lib/store/engine/library';
import type { ThemeListRow } from '@/lib/store/engine/types';

const row = (over: Partial<ThemeListRow>): ThemeListRow =>
  ({
    id: 'x',
    business_id: 'b',
    name: 'n',
    role: 'draft',
    preset: 'studio',
    updated_at: '2026-10-01T00:00:00.000Z',
    is_working: false,
    has_changes: false,
    ...over,
  }) as ThemeListRow;

describe('PRESET_CHOICES', () => {
  it('lists the five presets once each, in order, matching the preset look', () => {
    expect(PRESET_CHOICES.map((c) => c.preset)).toEqual(['studio', 'quick', 'grocery', 'khatario', 'blank']);
    expect(PRESET_CHOICES.map((c) => c.label)).toEqual(['Studio', 'Quick', 'Premium Grocery', 'Khatario', 'Blank']);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PRESET_LOOK } = require('@/lib/store/engine/presets/look');
    for (const c of PRESET_CHOICES) {
      expect(c.canvas).toBe(PRESET_LOOK[c.preset].canvas);
      expect(c.accent).toBe(PRESET_LOOK[c.preset].accent);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
  it('has the migrated choice text', () => {
    expect(MIGRATED_CHOICE).toEqual({
      label: 'Your current store design',
      description: 'A copy of how your store looks today',
    });
  });
});

describe('splitLibrary', () => {
  it('puts live first, separates the working draft and sorts drafts newest first', () => {
    const live = row({ id: 'L', role: 'live' });
    const w = row({ id: 'W', is_working: true });
    const a = row({ id: 'A', updated_at: '2026-10-02T00:00:00.000Z' });
    const b = row({ id: 'B', updated_at: '2026-10-05T00:00:00.000Z' });
    const out = splitLibrary([a, w, live, b]);
    expect(out.live?.id).toBe('L');
    expect(out.working?.id).toBe('W');
    expect(out.drafts.map((r) => r.id)).toEqual(['B', 'A']);
  });
  it('copes with an empty list', () => {
    expect(splitLibrary([])).toEqual({ live: null, working: null, drafts: [] });
  });
});

describe('themeActions', () => {
  const edit = { canEdit: true };
  it('live: no delete, publish or discard; has history', () => {
    const a = themeActions(row({ role: 'live' }), edit);
    expect(a.has('delete') || a.has('publish') || a.has('discard')).toBe(false);
    expect(a.has('history')).toBe(true);
    expect(['customise', 'preview', 'duplicate', 'rename'].every((k) => a.has(k as never))).toBe(true);
  });
  it('working draft: publish and discard only with changes; never delete', () => {
    const clean = themeActions(row({ is_working: true, has_changes: false }), edit);
    expect(clean.has('publish') || clean.has('discard') || clean.has('delete')).toBe(false);
    const dirty = themeActions(row({ is_working: true, has_changes: true }), edit);
    expect(dirty.has('publish') && dirty.has('discard')).toBe(true);
    expect(dirty.has('delete')).toBe(false);
    expect(dirty.has('history')).toBe(false);
  });
  it('a draft can be deleted and published', () => {
    const a = themeActions(row({}), edit);
    expect(a.has('delete') && a.has('publish')).toBe(true);
    expect(a.has('discard') || a.has('history')).toBe(false);
  });
  it('without edit permission only preview and history remain', () => {
    expect(Array.from(themeActions(row({ role: 'live' }), { canEdit: false })).sort()).toEqual(['history', 'preview']);
    expect(Array.from(themeActions(row({}), { canEdit: false }))).toEqual(['preview']);
  });
});

describe('canAddTheme', () => {
  it('stops at 20', () => {
    expect(canAddTheme(19)).toBe(true);
    expect(canAddTheme(20)).toBe(false);
  });
});

describe('dates and authors', () => {
  it('formats in India time', () => {
    expect(formatPublishedAt('2026-10-31T10:35:00.000Z')).toBe('31 Oct 2026, 4:05 pm');
  });
  it('labels a missing author', () => {
    expect(authorLabel(null)).toBe('Set up automatically');
    expect(authorLabel('Asha')).toBe('Asha');
  });
  it('relativeEdited boundaries', () => {
    const now = Date.parse('2026-10-31T10:00:00.000Z');
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const min = 60_000;
    expect(relativeEdited(ago(30_000), now)).toBe('just now');
    expect(relativeEdited(ago(5 * min), now)).toBe('5 min ago');
    expect(relativeEdited(ago(59 * min), now)).toBe('59 min ago');
    expect(relativeEdited(ago(60 * min), now)).toBe('1 h ago');
    expect(relativeEdited(ago(3 * 60 * min), now)).toBe('3 h ago');
    expect(relativeEdited(ago(24 * 60 * min), now)).toBe('1 day ago');
    expect(relativeEdited(ago(2 * 24 * 60 * min), now)).toBe('2 days ago');
    expect(relativeEdited(ago(7 * 24 * 60 * min), now)).toBe('24 Oct 2026');
    expect(relativeEdited(new Date(now + 5 * min).toISOString(), now)).toBe('just now');
  });
});

describe('library texts (D39, D41, D42, D52)', () => {
  it('labels presets and falls back to Studio', () => {
    expect(presetLabel('grocery')).toBe('Premium Grocery');
    expect(presetLabel('blank')).toBe('Blank');
    expect(presetLabel('nope' as never)).toBe('Studio');
  });
  it('counts themes against the limit', () => {
    expect(themeCountLabel(3)).toBe('3 of 20 themes');
    expect(themeCountLabel(1)).toBe('1 of 20 themes');
  });
  it('words the publish confirm, adding the classic-store sentence when the engine is off', () => {
    expect(publishConfirmText('Green 2', true)).toBe("Publish 'Green 2'? Shoppers will see it now.");
    expect(publishConfirmText('Green 2', false)).toBe(
      "Publish 'Green 2'? Shoppers will see it now. Shoppers still see your classic store. Published themes show only in preview links until the new store design is switched on.",
    );
    expect(ENGINE_OFF_NOTICE).toBe(
      'Shoppers still see your classic store. Published themes show only in preview links until the new store design is switched on.',
    );
  });
  it('words the delete and discard confirms and the preview toast', () => {
    expect(deleteConfirmText('Copy of Green 2')).toBe(
      "Delete 'Copy of Green 2'? This can't be undone. Versions it published stay in Version history.",
    );
    expect(DISCARD_CONFIRM).toBe('Discard unpublished changes? Your working copy goes back to the live theme.');
    expect(PREVIEW_COPIED).toBe('Preview link copied (works for 7 days)');
  });
  it('checks a theme name: 1 to 60 characters after trimming', () => {
    expect(checkThemeName('  ')).toBe('Enter a name');
    expect(checkThemeName('a'.repeat(61))).toBe('Use 60 characters or fewer');
    expect(checkThemeName(` ${'a'.repeat(60)} `)).toBeNull();
    expect(checkThemeName('Green 2')).toBeNull();
  });
  it('Customise on the live theme or the working draft goes through the working draft', () => {
    expect(customiseOpensWorkingDraft(row({ role: 'live' }))).toBe(true);
    expect(customiseOpensWorkingDraft(row({ is_working: true }))).toBe(true);
    expect(customiseOpensWorkingDraft(row({}))).toBe(false);
  });
  it('menu actions keep a fixed order, leave out Customise and have labels', () => {
    expect(MENU_ACTIONS).toEqual(['preview', 'duplicate', 'rename', 'publish', 'discard', 'history', 'delete']);
    for (const a of MENU_ACTIONS) expect(ACTION_LABELS[a].length).toBeGreaterThan(0);
    expect(ACTION_LABELS.discard).toBe('Discard changes');
    expect(ACTION_LABELS.preview).toBe('Preview link');
  });
});
