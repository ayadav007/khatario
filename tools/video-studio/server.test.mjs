import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findNpxCli } from './server.mjs';

function layout(rel) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npx-cli-'));
  const cli = path.join(dir, rel, 'node_modules/npm/bin/npx-cli.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '');
  return { dir, cli };
}

test('finds npx under lib/ for nvm and Linux installs', () => {
  const { dir, cli } = layout('lib');
  assert.equal(path.resolve(findNpxCli(path.join(dir, 'bin/node'), undefined)), cli);
});

test('finds npx beside node.exe on Windows', () => {
  const { dir, cli } = layout('');
  assert.equal(findNpxCli(path.join(dir, 'node.exe'), undefined), cli);
});

test('returns null when npm is missing so run() falls back to npx on PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npx-cli-'));
  assert.equal(findNpxCli(path.join(dir, 'bin/node'), undefined), null);
});

test('real node install resolves', () => {
  assert.ok(findNpxCli(), 'expected npx-cli.js next to this node');
});
