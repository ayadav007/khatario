describe('editor ops client safety', () => {
  it('ops.ts loads without sanitize-html or pg', () => {
    jest.isolateModules(() => {
      jest.doMock('sanitize-html', () => {
        throw new Error('server-only');
      });
      jest.doMock('pg', () => {
        throw new Error('server-only');
      });
      const ops = require('@/lib/store/engine/editor/ops');
      expect(typeof ops.addSection).toBe('function');
      expect(ops.OP_ERROR_TEXT.section_limit).toBe('A page can have up to 25 sections');
      // The real registry (and its sections/* chain) must have loaded, not a mock.
      expect(require('@/lib/store/engine/registry').SECTION_SCHEMAS['rich-text']).toBeDefined();
    });
  });

  it('library.ts and the library fetch client load with pg, sanitize-html and crypto throwing', () => {
    jest.isolateModules(() => {
      for (const m of ['sanitize-html', 'pg', 'crypto']) {
        jest.doMock(m, () => {
          throw new Error('server-only');
        });
      }
      const lib = require('@/lib/store/engine/library');
      expect(lib.PRESET_CHOICES).toHaveLength(5);
      const api = require('@/components/store/library/api');
      for (const k of [
        'listThemes',
        'createTheme',
        'renameTheme',
        'deleteTheme',
        'resetWorkingDraft',
        'listVersions',
        'restoreVersion',
        'versionPreviewLink',
        'publishTheme',
        'previewLink',
        'openWorkingDraft',
      ]) {
        expect(typeof api[k]).toBe('function');
      }
    });
  });
});
