import { readFileSync } from 'fs';
import { join } from 'path';
import { parseEvalSet, routeFor } from '../../../scripts/kb/eval';

jest.mock('@/lib/db', () => ({ queryRows: jest.fn(), closePool: jest.fn() }));

const cases = parseEvalSet(readFileSync(join(process.cwd(), 'tests', 'rag', 'eval-set.yml'), 'utf8')).filter((c) => c.route);

it('has owner routing cases', () => {
  expect(cases.filter((c) => c.route === 'insights').length).toBeGreaterThanOrEqual(8);
  expect(cases.filter((c) => c.route === 'guides').length).toBeGreaterThanOrEqual(3);
});

it.each(cases.map((c) => [c.q, c.route]))('%s -> %s', (q, route) => {
  expect(routeFor(q as string)).toBe(route);
});
