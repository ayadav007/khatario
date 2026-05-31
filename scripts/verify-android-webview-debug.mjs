#!/usr/bin/env node
/**
 * Runtime verification for Android WebView remote debugging.
 *
 * Usage (device connected, adb in PATH):
 *   node scripts/verify-android-webview-debug.mjs
 *
 * See docs/ANDROID_WEBVIEW_DEBUG.md
 */

import { execSync, spawnSync } from 'node:child_process';

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    const stderr = e.stderr?.toString?.() ?? '';
    const stdout = e.stdout?.toString?.() ?? '';
    return `[error] ${stderr || stdout || e.message}`;
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function adb(args) {
  return run(`adb ${args}`);
}

section('ADB devices');
console.log(adb('devices -l'));

const serial = adb('get-serialno');
if (!serial || serial.startsWith('[error]') || serial === 'unknown') {
  console.error('\nNo authorized device. Authorize USB debugging on the phone, then re-run.');
  process.exit(1);
}

section('Device');
console.log('manufacturer:', adb('shell getprop ro.product.manufacturer'));
console.log('model:', adb('shell getprop ro.product.model'));
console.log('android:', adb('shell getprop ro.build.version.release'));
console.log('sdk:', adb('shell getprop ro.build.version.sdk'));

section('WebView provider (dumpsys webviewupdate)');
console.log(adb('shell dumpsys webviewupdate').split('\n').slice(0, 25).join('\n'));

section('App process');
console.log(adb('shell pidof com.khatario.app') || '(not running — launch the app first)');

section('WebView debug sockets (/proc/net/unix grep webview_devtools)');
const sockets = adb('shell cat /proc/net/unix');
const webviewLines = sockets
  .split('\n')
  .filter((line) => /webview|devtools/i.test(line));
console.log(webviewLines.length ? webviewLines.join('\n') : '(no webview_devtools socket — debugging likely disabled or WebView not loaded)');

section('Recent KhatarioWebView logcat');
const log = spawnSync('adb', ['logcat', '-d', '-s', 'KhatarioWebView:*'], { encoding: 'utf8' });
console.log(log.stdout?.trim() || '(no KhatarioWebView logs yet — reinstall debug APK and open app)');

section('Chrome inspect checklist');
console.log([
  '1. Install debug APK: npm run cap:android:staging:install',
  '2. Open app on phone (keep in foreground)',
  '3. Desktop Chrome → chrome://inspect → enable "Discover USB devices"',
  '4. Look for: WebView in com.khatario.app (https://staging.khatario.com/...)',
  '5. Navigate phone to /debug/webview and click inspect',
  '6. If stale targets: kill app, adb kill-server && adb start-server, refresh inspect page',
].join('\n'));
