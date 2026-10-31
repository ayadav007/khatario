import { PARITY_WIDTHS, parityHtml, parityTargets, storeOrigin } from '@/lib/store/engine/parity';
import type { MigrationReportRow } from '@/lib/store/engine/migrate-runner';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.c2VjcmV0LXRva2Vu.abcDEF123';

describe('storeOrigin', () => {
  it('maps localhost, 127.0.0.1 and staging to store origins', () => {
    expect(storeOrigin('http://localhost:3015', 'ganesh')).toBe('http://ganesh.localhost:3015');
    expect(storeOrigin('http://localhost:3015/', 'ganesh')).toBe('http://ganesh.localhost:3015');
    expect(storeOrigin('http://127.0.0.1:3015', 'ganesh')).toBe('http://ganesh.localhost:3015');
    expect(storeOrigin('https://staging.khatario.com', 'theme-grocery')).toBe('https://theme-grocery.staging.khatario.com');
    expect(storeOrigin('https://staging.khatario.com/', 'theme-grocery')).toBe('https://theme-grocery.staging.khatario.com');
  });

  it('refuses production and any other host', () => {
    expect(() => storeOrigin('https://khatario.com', 'x')).toThrow();
    expect(() => storeOrigin('https://evil.com', 'x')).toThrow();
    expect(() => storeOrigin('https://khatario.com', 'ganesh')).toThrow();
    expect(() => storeOrigin('https://www.khatario.com', 'ganesh')).toThrow();
    expect(() => storeOrigin('https://evil.com', 'ganesh')).toThrow();
    expect(() => storeOrigin('https://staging.khatario.com.evil.com', 'ganesh')).toThrow();
    expect(() => storeOrigin('http://staging.khatario.com', 'ganesh')).toThrow();
    expect(() => storeOrigin('https://staging.khatario.com:8443', 'ganesh')).toThrow();
    expect(() => storeOrigin('https://localhost:3015', 'ganesh')).toThrow();
    expect(() => storeOrigin('http://user:pw@localhost:3015', 'ganesh')).toThrow();
    expect(() => storeOrigin('http://localhost:3015/store', 'ganesh')).toThrow();
    expect(() => storeOrigin('not a url', 'ganesh')).toThrow();
  });

  it('refuses a malformed subdomain', () => {
    for (const sub of ['x', 'ab', '-abc', 'abc-', 'Abc', 'a.b.c', 'a_bc', 'evil.com/x', '']) {
      expect(() => storeOrigin('http://localhost:3015', sub)).toThrow();
    }
  });
});

describe('PARITY_WIDTHS', () => {
  it('is phone and desktop', () => {
    expect(PARITY_WIDTHS).toEqual([390, 1280]);
  });
});

const row = (over: Partial<MigrationReportRow>): MigrationReportRow => ({
  business_id: '11111111-2222-4333-8444-555555555555',
  subdomain: 'ganesh',
  status: 'migrated',
  warnings: [],
  ...over,
});

describe('parityTargets', () => {
  it('gives the four demo stores with ?engine=1 new URLs', () => {
    const t = parityTargets({ base: 'https://staging.khatario.com', demos: true });
    expect(t).toHaveLength(4);
    expect(t.map((x) => x.label).sort()).toEqual(
      ['demo-theme-grocery', 'demo-theme-khatario', 'demo-theme-quick', 'demo-theme-studio'],
    );
    for (const x of t) {
      const sub = x.label.replace(/^demo-/, '');
      expect(x.oldUrl).toBe(`https://${sub}.staging.khatario.com/`);
      expect(x.newUrl).toBe(`https://${sub}.staging.khatario.com/?engine=1`);
    }
  });

  it('takes only migrated report rows that have a preview path', () => {
    const t = parityTargets({
      base: 'http://localhost:3015',
      demos: false,
      report: {
        rows: [
          row({ subdomain: 'ganesh', preview_path: `/?preview_theme=abc&pt=${TOKEN}` }),
          row({ subdomain: 'live-one', status: 'skipped_live', preview_path: '/?preview_theme=x&pt=y' }),
          row({ subdomain: 'no-link' }),
        ],
      },
    });
    expect(t).toEqual([
      {
        label: 'ganesh',
        oldUrl: 'http://ganesh.localhost:3015/',
        newUrl: `http://ganesh.localhost:3015/?preview_theme=abc&pt=${TOKEN}`,
      },
    ]);
  });

  it('skips report rows with a bad subdomain or a preview path that is not a local path', () => {
    const t = parityTargets({
      base: 'http://localhost:3015',
      demos: false,
      report: {
        rows: [
          row({ subdomain: null, preview_path: '/?pt=a' }),
          row({ subdomain: 'Bad.Sub', preview_path: '/?pt=a' }),
          row({ subdomain: 'abs-link', preview_path: 'https://evil.com/?pt=a' }),
          row({ subdomain: 'proto-rel', preview_path: '//evil.com/?pt=a' }),
        ],
      },
    });
    expect(t).toEqual([]);
  });

  it('combines demos and report rows, and --only filters by subdomain', () => {
    const report = { rows: [row({ subdomain: 'ganesh', preview_path: '/?pt=a' })] };
    expect(parityTargets({ base: 'http://localhost:3015', demos: true, report })).toHaveLength(5);
    const onlyDemo = parityTargets({ base: 'http://localhost:3015', demos: true, report, only: 'theme-quick' });
    expect(onlyDemo.map((x) => x.label)).toEqual(['demo-theme-quick']);
    const onlyStore = parityTargets({ base: 'http://localhost:3015', demos: true, report, only: 'ganesh' });
    expect(onlyStore.map((x) => x.label)).toEqual(['ganesh']);
    expect(parityTargets({ base: 'http://localhost:3015', demos: true, report, only: 'nobody' })).toEqual([]);
  });

  it('refuses a production base', () => {
    expect(() => parityTargets({ base: 'https://khatario.com', demos: true })).toThrow();
  });
});

describe('parityHtml', () => {
  const html = parityHtml([
    {
      label: '<script>alert(1)</script>',
      oldUrl: 'http://ganesh.localhost:3015/',
      newUrl: `http://ganesh.localhost:3015/?preview_theme=abc&pt=${TOKEN}`,
      shots: [
        { width: 390, old: 'ganesh/old-390.png', new: 'ganesh/new-390.png' },
        { width: 1280, old: 'ganesh/old-1280.png', new: '' },
      ],
    },
  ]);

  it('escapes labels', () => {
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('never contains the preview token', () => {
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain('c2VjcmV0LXRva2Vu');
    expect(html).toContain('pt=…');
  });

  it('shows old and new shots per width, with a failed cell', () => {
    expect(html).toContain('ganesh/old-390.png');
    expect(html).toContain('ganesh/new-390.png');
    expect(html).toContain('ganesh/old-1280.png');
    expect(html.indexOf('ganesh/old-390.png')).toBeLessThan(html.indexOf('ganesh/new-390.png'));
    expect(html).toMatch(/class="failed"/);
    expect(html).toContain('390');
    expect(html).toContain('1280');
  });

  it('escapes paths and URLs', () => {
    const out = parityHtml([
      { label: 'a', oldUrl: 'http://a.localhost:3015/"><b>', newUrl: 'http://a.localhost:3015/', shots: [{ width: 390, old: 'a/"x.png', new: 'a/new.png' }] },
    ]);
    expect(out).not.toContain('"><b>');
    expect(out).not.toContain('a/"x.png');
  });
});
