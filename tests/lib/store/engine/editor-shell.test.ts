import {
  editorFrameSrc,
  isEditableTarget,
  pruneSelection,
  saveStatusLabel,
  selectionRef,
  shellView,
  shortcutFor,
  shouldWarnOnLeave,
  toSelection,
  resolvePendingScroll,
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
    expect(shellView('idle', 'saved')).toEqual({ readOnly: false, statusLabel: 'Saved', blockingBanner: null });
    expect(shellView('idle', 'error', 'Boom').statusLabel).toBe('Error Boom');
  });

  it('is read-only while publishing or opening the next draft', () => {
    expect(shellView('leaving', 'saved')).toEqual({ readOnly: true, statusLabel: 'Saved', blockingBanner: null });
  });

  it('blocks with a reload banner when the next draft could not be opened', () => {
    expect(shellView('failed', 'saved')).toEqual({
      readOnly: true,
      statusLabel: 'Not saved',
      blockingBanner: 'This theme is now live. Reload the editor to keep editing.',
    });
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
