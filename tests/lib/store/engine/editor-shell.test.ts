import {
  editorFrameSrc,
  isEditableTarget,
  menuHoldItemId,
  pruneSelection,
  saveStatusLabel,
  selectionRef,
  shellView,
  acceptsEdits,
  shortcutFor,
  shouldWarnOnLeave,
  toSelection,
  resolvePendingScroll,
  remoteThemeState,
} from '@/lib/store/engine/editor/shell';
import type { Section, ThemeData } from '@/lib/store/engine/types';

const section = (blocks: string[] = []): Section => ({
  type: 'rich-text',
  settings: {},
  blocks: Object.fromEntries(blocks.map((id) => [id, { type: 'text', settings: {} }])),
  block_order: blocks,
});

const theme: ThemeData = {
  settings: {} as ThemeData['settings'],
  header_group: { order: ['hd'], sections: { hd: section() } },
  footer_group: { order: [], sections: {} },
  templates: { home: { order: ['s1'], sections: { s1: section(['b1']) } } },
};

describe('editor shell helpers', () => {
  it('maps every save status to its label', () => {
    expect(saveStatusLabel('saved')).toBe('Saved');
    expect(saveStatusLabel('saving')).toBe('Saving…');
    expect(saveStatusLabel('pending')).toBe('Unsaved');
    expect(saveStatusLabel('offline')).toBe('Offline');
    expect(saveStatusLabel('error', 'Theme is too large')).toBe('Error Theme is too large');
    expect(saveStatusLabel('error')).toBe('Error');
    expect(saveStatusLabel('conflict', 'x')).toBe('Not saved');
    expect(saveStatusLabel('locked')).toBe('Not saved');
    expect(saveStatusLabel('gone')).toBe('Not saved');
  });

  it('warns on leave only while edits are not on the server', () => {
    expect(['pending', 'saving', 'offline'].every((s) => shouldWarnOnLeave(s as never))).toBe(true);
    expect(['saved', 'conflict', 'locked', 'error'].some((s) => shouldWarnOnLeave(s as never))).toBe(false);
  });

  it('turns a preview ref into a section selection and back', () => {
    const ref = { group: 'template' as const, id: 's1' };
    expect(toSelection(ref)).toEqual({ kind: 'section', ref });
    expect(toSelection(null)).toBeNull();
    expect(selectionRef({ kind: 'section', ref })).toEqual(ref);
    expect(selectionRef({ kind: 'block', ref, blockId: 'b1' })).toEqual(ref);
    expect(selectionRef({ kind: 'theme' })).toBeNull();
    expect(selectionRef({ kind: 'menus' })).toBeNull();
    expect(selectionRef({ kind: 'menu', menuId: 'main', itemId: null })).toBeNull();
    expect(selectionRef(null)).toBeNull();
  });

  it('prunes a selection whose section or block no longer exists', () => {
    const s1 = { group: 'template' as const, id: 's1' };
    const sel = { kind: 'section' as const, ref: s1 };
    expect(pruneSelection(theme, 'home', sel)).toBe(sel);
    expect(pruneSelection(theme, 'home', { kind: 'section', ref: { group: 'header', id: 'hd' } })).not.toBeNull();
    expect(pruneSelection(theme, 'home', { kind: 'section', ref: { group: 'template', id: 'gone' } })).toBeNull();
    expect(pruneSelection(theme, 'home', { kind: 'section', ref: { group: 'footer', id: 's1' } })).toBeNull();
    const blk = { kind: 'block' as const, ref: s1, blockId: 'b1' };
    expect(pruneSelection(theme, 'home', blk)).toBe(blk);
    expect(pruneSelection(theme, 'home', { kind: 'block', ref: s1, blockId: 'gone' })).toEqual(sel);
    expect(pruneSelection(theme, 'home', { kind: 'section', ref: { group: 'template', id: '__proto__' } })).toBeNull();
    const th = { kind: 'theme' as const };
    expect(pruneSelection(theme, 'home', th)).toBe(th);
    expect(pruneSelection(theme, 'home', null)).toBeNull();
  });

  it('holds a top item of the menu the header uses, and nothing else', () => {
    const item = (id: string, children?: { id: string; label: string; link: string }[]) => ({ id, label: id, link: '', children });
    const withHeader = (menu?: string): ThemeData => ({
      ...theme,
      header_group: {
        order: ['hd'],
        sections: { hd: { ...section(), type: 'header', settings: menu === undefined ? {} : { menu } } },
      },
      settings: {
        menus: [
          { id: 'main', name: 'Main', items: [item('shop', [{ id: 'kid', label: 'Kid', link: '/' }]), item('about')] },
          { id: 'sale', name: 'Sale', items: [item('deals')] },
        ],
      } as unknown as ThemeData['settings'],
    });
    const pick = (menuId: string, itemId: string | null) => ({ kind: 'menu' as const, menuId, itemId });
    // The header uses main by default (and when its setting names a menu that is gone).
    expect(menuHoldItemId(withHeader(), pick('main', 'shop'))).toBe('shop');
    expect(menuHoldItemId(withHeader('gone'), pick('main', 'about'))).toBe('about');
    // A nested item, the whole menu, another menu, a missing item and other selections release it.
    expect(menuHoldItemId(withHeader(), pick('main', 'kid'))).toBeNull();
    expect(menuHoldItemId(withHeader(), pick('main', null))).toBeNull();
    expect(menuHoldItemId(withHeader(), pick('sale', 'deals'))).toBeNull();
    expect(menuHoldItemId(withHeader(), pick('main', 'gone'))).toBeNull();
    expect(menuHoldItemId(withHeader(), { kind: 'menus' })).toBeNull();
    expect(menuHoldItemId(withHeader(), null)).toBeNull();
    // Following the header's own menu setting.
    expect(menuHoldItemId(withHeader('sale'), pick('sale', 'deals'))).toBe('deals');
    expect(menuHoldItemId(withHeader('sale'), pick('main', 'shop'))).toBeNull();
    // No header section or no menus list is safe.
    expect(menuHoldItemId(theme, pick('main', 'shop'))).toBeNull();
  });

  it('prunes a menu selection whose menu or item no longer exists', () => {
    const withMenus: ThemeData = {
      ...theme,
      settings: {
        menus: [{ id: 'main', name: 'Main', items: [{ id: 'a', label: 'A', link: '', children: [{ id: 'a1', label: 'A1', link: '' }] }] }],
      } as unknown as ThemeData['settings'],
    };
    const menus = { kind: 'menus' as const };
    expect(pruneSelection(withMenus, 'home', menus)).toBe(menus);
    const whole = { kind: 'menu' as const, menuId: 'main', itemId: null };
    expect(pruneSelection(withMenus, 'home', whole)).toBe(whole);
    const item = { kind: 'menu' as const, menuId: 'main', itemId: 'a1' };
    expect(pruneSelection(withMenus, 'home', item)).toBe(item);
    expect(pruneSelection(withMenus, 'home', { kind: 'menu', menuId: 'main', itemId: 'gone' })).toEqual(whole);
    expect(pruneSelection(withMenus, 'home', { kind: 'menu', menuId: 'gone', itemId: 'a' })).toEqual(menus);
    expect(pruneSelection(withMenus, 'home', { kind: 'menu', menuId: '__proto__', itemId: null })).toEqual(menus);
    // A theme with no menus list at all still prunes safely.
    expect(pruneSelection(theme, 'home', whole)).toEqual(menus);
  });

  it('reads undo and redo shortcuts', () => {
    const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
      shortcutFor({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
    expect(k('z', { ctrlKey: true })).toBe('undo');
    expect(k('z', { metaKey: true })).toBe('undo');
    expect(k('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(k('z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(k('y', { ctrlKey: true })).toBe('redo');
    expect(k('z')).toBeNull();
    expect(k('z', { ctrlKey: true, altKey: true })).toBeNull();
    expect(k('y', { metaKey: true })).toBeNull();
    expect(k('x', { ctrlKey: true })).toBeNull();
  });

  it('treats inputs, textareas, selects and contenteditable as editable', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('adds editor=1 to a preview link', () => {
    expect(editorFrameSrc('https://g.khatario.com/?preview_theme=x&pt=y')).toBe(
      'https://g.khatario.com/?preview_theme=x&pt=y&editor=1',
    );
    expect(editorFrameSrc('http://g.localhost:3016/')).toBe('http://g.localhost:3016/?editor=1');
    expect(editorFrameSrc('not a url')).toBeNull();
  });
});

describe('editor shell view while leaving the theme', () => {
  it('is editable and shows the save status while idle', () => {
    expect(shellView('idle', 'saved')).toEqual({ readOnly: false, statusLabel: 'Saved', blockingBanner: null, retry: false });
    expect(shellView('idle', 'error', 'Boom').statusLabel).toBe('Error Boom');
  });

  it('is read-only while publishing or opening the next draft', () => {
    expect(shellView('leaving', 'saved')).toEqual({ readOnly: true, statusLabel: 'Saved', blockingBanner: null, retry: false });
  });

  it('blocks with a reload banner when the next draft could not be opened', () => {
    expect(shellView('failed', 'saved')).toEqual({
      readOnly: true,
      statusLabel: 'Not saved',
      blockingBanner: 'This theme is now live. Reload the editor to keep editing.',
      retry: false,
    });
  });

  // Final review I2: once saving stopped, a new edit could only rewrite the backup on a stale design.
  it.each(['conflict', 'locked', 'gone'] as const)('is read-only once the save is stopped (%s), until Reload', (s) => {
    expect(shellView('idle', s).readOnly).toBe(true);
    expect(acceptsEdits('idle', s)).toBe(false);
  });

  it.each(['saved', 'pending', 'saving', 'offline', 'error'] as const)('accepts edits while idle and %s', (s) => {
    expect(shellView('idle', s).readOnly).toBe(false);
    expect(acceptsEdits('idle', s)).toBe(true);
  });

  it('accepts no edits while leaving or after a failed leave', () => {
    expect(acceptsEdits('leaving', 'saved')).toBe(false);
    expect(acceptsEdits('failed', 'saved')).toBe(false);
  });

  // Final review M1: a failed move after a delete is not called "now live", and offers Try again.
  it('says the theme was deleted, with Try again, when the move after a delete failed', () => {
    const none = shellView('failed', 'saved', undefined, { gone: 'none' });
    expect(none).toEqual({
      readOnly: true,
      statusLabel: 'Not saved',
      blockingBanner: "This theme was deleted and your working copy couldn't be opened.",
      retry: true,
    });
    expect(none.blockingBanner).not.toMatch(/now live/);
    expect(shellView('failed', 'gone', undefined, { gone: 'kept' }).blockingBanner).toBe(
      "This theme was deleted and your working copy couldn't be opened. Your unsaved changes are kept on this device and will be offered on your working copy.",
    );
    expect(shellView('failed', 'gone', undefined, { gone: 'tab_only' }).blockingBanner).toBe(
      "This theme was deleted and your working copy couldn't be opened. Your unsaved changes couldn't be stored on this device: keep this tab open and try again.",
    );
  });
});

describe('isEditableTarget input types', () => {
  it('keeps shortcuts on toggles, ranges and buttons', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'button' })).toBe(false);
  });
});

describe('pending scroll after a save', () => {
  const ref = { group: 'template' as const, id: 'new1' };

  it('waits for a ready whose rev is past the save count at select time', () => {
    const pending = { ref, afterRev: 2 };
    expect(resolvePendingScroll(pending, 2)).toEqual({ resend: null, pending });
    expect(resolvePendingScroll(pending, 1)).toEqual({ resend: null, pending });
    expect(resolvePendingScroll(pending, 3)).toEqual({ resend: ref, pending: null });
  });

  it('keeps waiting on a reloaded frame (rev null) and does nothing without a pending ref', () => {
    const pending = { ref, afterRev: 0 };
    expect(resolvePendingScroll(pending, null)).toEqual({ resend: null, pending });
    expect(resolvePendingScroll(null, 5)).toEqual({ resend: null, pending: null });
  });
});

describe('remoteThemeState (another tab)', () => {
  const local = (status: 'saved' | 'pending' | 'saving') => ({ updatedAt: 'v1', status });
  const remote = (role: 'live' | 'draft', updated_at: string) => ({ role, updated_at });

  it('is gone when the theme no longer exists', () => {
    expect(remoteThemeState(local('saved'), null)).toBe('gone');
    expect(remoteThemeState(local('pending'), null)).toBe('gone');
  });

  it('is live when the theme was published', () => {
    expect(remoteThemeState(local('saved'), remote('live', 'v2'))).toBe('live');
    expect(remoteThemeState(local('saved'), remote('live', 'v1'))).toBe('live');
  });

  it('is changed when the server moved on while nothing of ours is unsaved', () => {
    expect(remoteThemeState(local('saved'), remote('draft', 'v2'))).toBe('changed');
  });

  it('is the same while our own save is pending or in flight', () => {
    expect(remoteThemeState(local('pending'), remote('draft', 'v2'))).toBe('same');
    expect(remoteThemeState(local('saving'), remote('draft', 'v2'))).toBe('same');
  });

  it('is the same for an equal updated_at', () => {
    expect(remoteThemeState(local('saved'), remote('draft', 'v1'))).toBe('same');
  });
});

// Final review I2/M1: the editor wiring (a client component; jest here is node-only, so a source check).
describe('Studio2Editor wiring (final review I2, M1)', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const src = readFileSync(join(process.cwd(), 'components/store/studio2/Studio2Editor.tsx'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'app/(app)/settings/online-store/themes/[id]/editor/page.tsx'), 'utf8');

  it('apply, undo and redo refuse edits once saving stopped, and the panes follow view.readOnly', () => {
    expect(src.match(/if \(!acceptsEdits\(leaveRef\.current, statusRef\.current\)\) return/g)).toHaveLength(3);
    expect(src).toContain('readOnly: view.readOnly,');
    expect(src).toContain('readOnly={view.readOnly}');
    expect(src).not.toContain("readOnly: leave !== 'idle'");
  });

  it('a delete leads to a gone-aware move, which keeps the edits when it fails', () => {
    expect(src.match(/goToWorkingDraftRef\.current\(true, 'gone'\)/g)).toHaveLength(2);
    expect(src).toContain('keepGoneBackup(safeStorage(), businessId, row.id, historyRef.current.present, Date.now())');
    expect(src).toContain('<BannerButton onClick={retryLeave}>Try again</BannerButton>');
  });

  it('the editor page opens through backupOnOpen, so an outdated backup is never offered', () => {
    expect(page).toContain('backupOnOpen(storage, business.id, theme)');
    expect(page).not.toContain('staleBackup');
  });
});
