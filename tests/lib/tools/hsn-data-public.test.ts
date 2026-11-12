import fs from 'fs';
import path from 'path';

const DATA_PATH = '/data/hsn_master.json';
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('HSN finder data stays public', () => {
  it('lists the exact data path in the middleware PUBLIC_PATHS set', () => {
    const src = read('middleware.ts');
    const start = src.indexOf('const PUBLIC_PATHS = new Set([');
    const end = src.indexOf(']);', start);
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, end)).toContain(`'${DATA_PATH}'`);
  });
  it('is the path the HSN finder fetches', () => {
    expect(read('components/tools/HsnFinderTool.tsx')).toContain(`fetch('${DATA_PATH}')`);
  });
});
