#!/usr/bin/env node
/**
 * Writes capacitor-shell/config.json with the server URL baked in at cap sync.
 * Used by offline.html (errorPath) to know where to redirect when back online.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const shellDir = join(root, 'capacitor-shell');

const DEFAULT_SERVER = 'https://app.khatario.com';
const raw = (process.env.CAP_SERVER_URL || DEFAULT_SERVER).trim();

function resolveServerUrl(input) {
  try {
    const url = new URL(input);
    if (url.pathname === '/' || url.pathname === '') {
      url.pathname = '/login';
    }
    return url.href;
  } catch {
    const base = input.replace(/\/$/, '');
    return base.endsWith('/login') ? base : `${base}/login`;
  }
}

const serverUrl = resolveServerUrl(raw);
const bootstrapUrl = (() => {
  try {
    const url = new URL(serverUrl);
    url.pathname = '/dashboard';
    url.search = '';
    return url.href;
  } catch {
    const base = serverUrl.replace(/\/(login|dashboard)\/?$/, '');
    return `${base}/dashboard`;
  }
})();
const environment = serverUrl.includes('staging') ? 'staging' : 'production';

mkdirSync(shellDir, { recursive: true });

const payload = {
  serverUrl,
  bootstrapUrl,
  environment,
  generatedAt: new Date().toISOString(),
};

writeFileSync(join(shellDir, 'config.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`✓ Wrote capacitor-shell/config.json → ${serverUrl} (bootstrap: ${bootstrapUrl})`);
