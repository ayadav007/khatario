import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BLOCK_TYPES } from '@/lib/marketing-builder/block-types';
import { HOME_SECTIONS } from '@/lib/marketing-builder/default-home';

/**
 * The editor config is a .tsx file (JSX field renderers), which this Jest setup does not compile,
 * so this checks its source: a block type the sanitizer accepts but the editor never registers
 * would publish fine and then render nothing.
 */
const CONFIG_SOURCE = readFileSync(
  path.join(__dirname, '..', '..', '..', 'components', 'marketing', 'builder', 'config.tsx'),
  'utf8',
);

function registration(type: string): string | null {
  const start = CONFIG_SOURCE.indexOf(`\n    ${type}: {\n`);
  if (start < 0) return null;
  const end = CONFIG_SOURCE.indexOf('\n    },\n', start);
  return CONFIG_SOURCE.slice(start, end);
}

describe('Site Builder config', () => {
  it.each([...BLOCK_TYPES])('registers %s with a renderer and default content', (type) => {
    const block = registration(type);
    expect(block).not.toBeNull();
    expect(block).toMatch(/\n {6}render: /);
    expect(block).toMatch(/\n {6}defaultProps: /);
  });

  it('only lists registered sections on the default home page', () => {
    for (const type of HOME_SECTIONS) expect(registration(type)).not.toBeNull();
  });
});
