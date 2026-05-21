#!/usr/bin/env node
/**
 * Build/install Capacitor Android with an explicit environment URL.
 * Prevents accidentally shipping app.khatario.com while still on staging.
 *
 * Usage:
 *   node scripts/cap-android-build.mjs staging
 *   node scripts/cap-android-build.mjs staging --install
 *   node scripts/cap-android-build.mjs production --install
 *
 * See docs/SERVER_INFRASTRUCTURE.md
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ENV_URLS = {
  staging: 'https://staging.khatario.com',
  production: 'https://app.khatario.com',
};

const envName = (process.argv[2] || 'staging').toLowerCase();
const shouldInstall = process.argv.includes('--install');

if (!ENV_URLS[envName]) {
  console.error(`Unknown environment "${envName}". Use: staging | production`);
  process.exit(1);
}

const serverUrl = ENV_URLS[envName];

if (envName === 'production') {
  console.warn(
    '⚠️  Production build: ensure app.khatario.com nginx vhost is live (see docs/SERVER_INFRASTRUCTURE.md).'
  );
}

console.log(`\nCapacitor Android — ${envName}`);
console.log(`CAP_SERVER_URL=${serverUrl}\n`);

const env = { ...process.env, CAP_SERVER_URL: serverUrl };

execSync('npx cap sync android', { cwd: root, stdio: 'inherit', env });

const configPath = join(root, 'android/app/src/main/assets/capacitor.config.json');
if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const actual = config?.server?.url ?? '(missing)';
  const expected = envName === 'staging'
    ? 'https://staging.khatario.com/login'
    : 'https://app.khatario.com/login';
  if (actual !== expected) {
    console.error(`\n❌ capacitor.config.json url mismatch:`);
    console.error(`   expected: ${expected}`);
    console.error(`   actual:   ${actual}`);
    process.exit(1);
  }
  console.log(`✓ Verified server.url → ${actual}`);
}

if (shouldInstall) {
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  execSync(`${gradle} installDebug`, {
    cwd: join(root, 'android'),
    stdio: 'inherit',
    shell: true,
  });
  console.log('\n✅ Installed on connected device (adb).');
} else {
  console.log('\n✅ Sync complete. Run with --install to install on a connected phone.');
}
