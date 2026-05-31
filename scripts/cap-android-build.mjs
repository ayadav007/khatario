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

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function resolveAdb() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (sdkRoot) {
    const candidate = join(sdkRoot, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}

function runAdb(args) {
  const adb = resolveAdb();
  const result = spawnSync(adb, args, { encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  };
}

/** Samsung devices often hang installDebug when ADB is stale — restart and verify first. */
function adbPreflight() {
  console.log('\nADB preflight…');
  try {
    runAdb(['kill-server']);
    runAdb(['start-server']);
  } catch (e) {
    console.warn('⚠️  Could not restart adb:', e.message);
    console.warn('   Ensure Android platform-tools are on PATH or ANDROID_HOME is set.');
    return { serial: null, ready: [] };
  }

  const devices = runAdb(['devices']);
  console.log(devices.stdout || devices.stderr);
  const ready = (devices.stdout || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.endsWith('\tdevice'))
    .map((line) => line.split('\t')[0]);

  if (ready.length === 0) {
    console.error('\n❌ No authorized device (state must be "device", not offline/unauthorized).');
    console.error('   On Samsung: unlock phone, accept RSA prompt, use a data-capable USB mode, then retry.');
    console.error('   Or build APK only: npm run cap:android:staging:apk');
    process.exit(1);
  }

  const serial = ready.length === 1 ? ready[0] : null;
  for (const id of ready) {
    const sdk = runAdb(['-s', id, 'shell', 'getprop', 'ro.build.version.sdk']);
    if (sdk.status !== 0 || !sdk.stdout) {
      console.warn(`⚠️  Could not read API level for ${id} (ADB shell timeout).`);
      console.warn('   Gradle installDebug often fails with "Unknown API Level" in this state.');
    } else {
      console.log(`✓ ${id} API level ${sdk.stdout}`);
    }
  }
  console.log(`✓ ${ready.length} device(s) ready for install\n`);
  return { serial, ready };
}

function installApkViaAdb(apkPath, serial) {
  if (!existsSync(apkPath)) {
    console.error(`\n❌ APK not found: ${apkPath}`);
    process.exit(1);
  }
  const args = serial ? ['-s', serial, 'install', '-r', apkPath] : ['install', '-r', apkPath];
  console.log(`\nInstalling via adb ${serial ? `-s ${serial} ` : ''}install -r …`);
  const result = runAdb(args);
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || 'adb install failed');
    process.exit(1);
  }
  console.log(result.stdout || 'Success');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const ENV_URLS = {
  staging: 'https://staging.khatario.com',
  production: 'https://app.khatario.com',
};

const envName = (process.argv[2] || 'staging').toLowerCase();
const shouldInstall = process.argv.includes('--install');
const apkOnly = process.argv.includes('--apk');

if (!ENV_URLS[envName]) {
  console.error(`Unknown environment "${envName}". Use: staging | production`);
  process.exit(1);
}

const serverUrl = ENV_URLS[envName];

const env = {
  ...process.env,
  CAP_SERVER_URL: serverUrl,
  // Always allow chrome://inspect for staging APK builds unless explicitly disabled.
  CAP_WEBVIEW_DEBUG: process.env.CAP_WEBVIEW_DEBUG ?? (envName === 'staging' ? 'true' : 'false'),
};

if (envName === 'production') {
  console.warn(
    '⚠️  Production build: ensure app.khatario.com nginx vhost is live (see docs/SERVER_INFRASTRUCTURE.md).'
  );
}

console.log(`\nCapacitor Android — ${envName}`);
console.log(`CAP_SERVER_URL=${serverUrl}`);
console.log(`CAP_WEBVIEW_DEBUG=${env.CAP_WEBVIEW_DEBUG}\n`);

execSync('node scripts/write-capacitor-shell-config.mjs', {
  cwd: root,
  stdio: 'inherit',
  env,
});

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
  const webViewDebug = config?.android?.webContentsDebuggingEnabled;
  if (envName === 'staging' && webViewDebug !== true) {
    console.error(`\n❌ capacitor.config.json android.webContentsDebuggingEnabled must be true for staging`);
    console.error(`   actual: ${webViewDebug}`);
    process.exit(1);
  }
  if (webViewDebug === true) {
    console.log('✓ Verified android.webContentsDebuggingEnabled → true');
  }
  const errorPath = config?.server?.errorPath ?? '(missing)';
  if (errorPath !== 'offline.html') {
    console.error(`\n❌ capacitor.config.json errorPath mismatch:`);
    console.error(`   expected: offline.html`);
    console.error(`   actual:   ${errorPath}`);
    process.exit(1);
  }
  console.log(`✓ Verified server.url → ${actual}`);
  console.log(`✓ Verified server.errorPath → ${errorPath}`);
}

if (shouldInstall || apkOnly) {
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const androidDir = join(root, 'android');

  if (apkOnly) {
    execSync(`${gradle} assembleDebug`, {
      cwd: androidDir,
      stdio: 'inherit',
      shell: true,
    });
    const apkPath = join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
    console.log(`\n✅ Debug APK built:\n   ${apkPath}`);
    console.log('   Install manually: adb install -r app/build/outputs/apk/debug/app-debug.apk');
  } else {
    const { serial } = adbPreflight();
    // assembleDebug + adb install avoids Gradle installDebug/ddmlib "Unknown API Level" on Samsung.
    execSync(`${gradle} assembleDebug`, {
      cwd: androidDir,
      stdio: 'inherit',
      shell: true,
    });
    const apkPath = join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk');
    installApkViaAdb(apkPath, serial);
    console.log('\n✅ Installed on connected device (adb install -r).');
  }
} else {
  console.log('\n✅ Sync complete. Run with --install to install on a connected phone.');
  console.log('   Or: npm run cap:android:staging:apk  then adb install -r …');
}
