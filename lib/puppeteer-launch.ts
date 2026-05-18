/**
 * Puppeteer 24+ does not ship Chrome in node_modules; it expects either
 * `npx puppeteer browsers install chrome` or a system browser / PUPPETEER_EXECUTABLE_PATH.
 * This module centralizes discovery so PDF routes work on dev machines without the cache download.
 */

import { existsSync } from 'node:fs';
import type { LaunchOptions } from 'puppeteer';

const DEFAULT_ARGS: string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-software-rasterizer',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

/**
 * Returns an absolute path to a Chrome/Chromium binary when one is found.
 */
export function resolveSystemChromeExecutable(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const candidates = [
      local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : undefined,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ].filter((p): p is string => Boolean(p));
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }

  if (process.platform === 'darwin') {
    const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (existsSync(p)) return p;
  }

  const linuxCandidates = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
  ];
  for (const p of linuxCandidates) {
    if (existsSync(p)) return p;
  }

  return undefined;
}

function mergeArgs(override?: string[]): string[] {
  if (!override?.length) return [...DEFAULT_ARGS];
  return [...new Set([...DEFAULT_ARGS, ...override])];
}

/**
 * Launch options for puppeteer.launch().
 * Prefer explicit/system Chrome; otherwise use installed Google Chrome via `channel` (Windows/macOS/Linux with Chrome).
 */
export function getPuppeteerLaunchOptions(overrides: LaunchOptions = {}): LaunchOptions {
  const {
    args: overrideArgs,
    executablePath: overrideExe,
    channel: overrideChannel,
    ...rest
  } = overrides;

  const args = mergeArgs(overrideArgs as string[] | undefined);
  const resolvedExe =
    (typeof overrideExe === 'string' && overrideExe && existsSync(overrideExe) && overrideExe) ||
    resolveSystemChromeExecutable();

  if (resolvedExe) {
    return {
      headless: true,
      ...rest,
      executablePath: resolvedExe,
      args,
    };
  }

  return {
    headless: true,
    ...rest,
    channel: overrideChannel ?? 'chrome',
    args,
  };
}
