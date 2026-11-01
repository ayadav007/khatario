import { acceptEditorMessage } from '@/lib/store/engine/editor/bridge';

const parent = { name: 'parent window' };
const other = { name: 'some other window' };
const allowed = ['http://localhost:3016', 'http://127.0.0.1:3016'];
const refresh = { source: 'kh-studio', type: 'refresh', rev: 4 };

describe('acceptEditorMessage', () => {
  it('accepts a valid message from the parent on an allowed origin and locks that origin', () => {
    expect(
      acceptEditorMessage({ origin: 'http://localhost:3016', source: parent, data: refresh }, { parent, allowed, locked: null }),
    ).toEqual({ msg: refresh, lock: 'http://localhost:3016' });
  });

  it('rejects a spoofed origin', () => {
    expect(
      acceptEditorMessage({ origin: 'https://evil.example', source: parent, data: refresh }, { parent, allowed, locked: null }),
    ).toBeNull();
  });

  it('rejects a message from a window other than the parent, and any message when not framed', () => {
    expect(
      acceptEditorMessage({ origin: 'http://localhost:3016', source: other, data: refresh }, { parent, allowed, locked: null }),
    ).toBeNull();
    expect(
      acceptEditorMessage({ origin: 'http://localhost:3016', source: null, data: refresh }, { parent: null, allowed, locked: null }),
    ).toBeNull();
  });

  it('rejects another allowed origin once the first one is locked', () => {
    const ctx = { parent, allowed, locked: 'http://localhost:3016' };
    expect(acceptEditorMessage({ origin: 'http://127.0.0.1:3016', source: parent, data: refresh }, ctx)).toBeNull();
    expect(acceptEditorMessage({ origin: 'http://localhost:3016', source: parent, data: refresh }, ctx)?.msg).toEqual(refresh);
  });

  it('rejects malformed data', () => {
    const ctx = { parent, allowed, locked: null };
    for (const data of [null, 'refresh', { source: 'kh-studio', type: 'refresh', rev: -1 }, { source: 'x', type: 'refresh', rev: 1 }, { source: 'kh-studio', type: 'nope' }]) {
      expect(acceptEditorMessage({ origin: 'http://localhost:3016', source: parent, data }, ctx)).toBeNull();
    }
  });
});
