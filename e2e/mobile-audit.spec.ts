import fs from 'fs';
import path from 'path';
import { test, type Page } from '@playwright/test';
const routes = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8')) as string[];

const ROOT = path.join(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT, 'screenshots');
const REPORT_PATH = path.join(ROOT, 'mobile-report.json');

type Issue = {
  tag: string;
  text: string;
  fontSize?: number;
  width?: number;
  height?: number;
  right?: number;
};

type Category =
  | 'horizontal_scroll'
  | 'overflow_right'
  | 'text_under_12px'
  | 'control_too_tall'
  | 'control_too_short'
  | 'wide_button'
  | 'load_error'
  | 'still_loading';

const CATEGORIES: Category[] = [
  'horizontal_scroll',
  'overflow_right',
  'text_under_12px',
  'control_too_tall',
  'control_too_short',
  'wide_button',
  'load_error',
  'still_loading',
];

function screenshotName(route: string) {
  const slug = route === '/' ? 'home' : route.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '_');
  return `${slug.slice(0, 120)}.png`;
}

test('audit every route at 375px', async ({ page }) => {
  test.setTimeout(6 * 60 * 60 * 1000);
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.setViewportSize({ width: 375, height: 812 });

  const routeReports: Array<{
    route: string;
    finalUrl: string;
    screenshot: string;
    counts: Record<Category, number>;
    issues: Record<Category, Issue[]>;
  }> = [];

  for (const route of routes) {
    const counts = Object.fromEntries(CATEGORIES.map((key) => [key, 0])) as Record<Category, number>;
    const issues = Object.fromEntries(CATEGORIES.map((key) => [key, [] as Issue[]])) as Record<Category, Issue[]>;
    const file = screenshotName(route);
    let finalUrl = route;

    try {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 120000 });
      finalUrl = page.url();
      if (!response || response.status() >= 500) {
        counts.load_error = 1;
        issues.load_error.push({ tag: 'document', text: `HTTP ${response?.status() ?? 'no response'}` });
      }
      const ready = await waitForContent(page);
      if (!ready.settled) {
        counts.still_loading = 1;
        issues.still_loading.push({
          tag: 'document',
          text: 'page was still on a loading spinner after 30s',
        });
      }
      const found = await page.evaluate(collectIssues);
      for (const key of CATEGORIES) {
        if (key === 'load_error' || key === 'still_loading') continue;
        counts[key] = found.counts[key] || 0;
        issues[key] = found.samples[key] || [];
      }
    } catch (error) {
      counts.load_error = 1;
      issues.load_error.push({
        tag: 'document',
        text: error instanceof Error ? error.message.slice(0, 300) : 'navigation failed',
      });
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, file), fullPage: true }).catch(() => undefined);
    routeReports.push({ route, finalUrl, screenshot: `screenshots/${file}`, counts, issues });
  }

  const totals = Object.fromEntries(CATEGORIES.map((key) => [key, 0])) as Record<Category, number>;
  for (const entry of routeReports) {
    for (const key of CATEGORIES) totals[key] += entry.counts[key];
  }

  fs.writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        viewport: { width: 375, height: 812 },
        generatedAt: new Date().toISOString(),
        routeCount: routes.length,
        totals,
        routes: routeReports,
      },
      null,
      2
    )
  );
});

async function waitForContent(page: Page) {
  const timeoutMs = 30000;
  const started = Date.now();
  let stable = 0;
  let previous = '';

  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);

  while (Date.now() - started < timeoutMs) {
    const snapshot = await page
      .evaluate(() => {
        const spinners = Array.from(document.querySelectorAll('.animate-spin'));
        const blocking = spinners.some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width >= 24 && rect.height >= 24;
        });
        const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
        return { blocking, text: text.slice(0, 240) };
      })
      .catch(() => null);

    if (!snapshot) {
      await page.waitForTimeout(500);
      continue;
    }

    if (!snapshot.blocking && snapshot.text === previous) {
      stable += 1;
      if (stable >= 2) return { settled: true };
    } else {
      stable = 0;
      previous = snapshot.text;
    }
    await page.waitForTimeout(700);
  }

  return { settled: false };
}

function collectIssues() {
  const isDecorative = (el: HTMLElement) => {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const role = el.getAttribute('role');
    if (role === 'presentation' || role === 'none') return true;
    return !!el.closest('[aria-hidden="true"], [role="presentation"], [role="none"]');
  };
  const viewportWidth = document.documentElement.clientWidth;
  const keys = [
    'horizontal_scroll',
    'overflow_right',
    'text_under_12px',
    'control_too_tall',
    'control_too_short',
    'wide_button',
  ] as const;
  const counts: Record<string, number> = {};
  const samples: Record<string, Array<{ tag: string; text: string; fontSize?: number; width?: number; height?: number; right?: number }>> = {};
  for (const key of keys) {
    counts[key] = 0;
    samples[key] = [];
  }
  const push = (key: string, item: { tag: string; text: string; fontSize?: number; width?: number; height?: number; right?: number }) => {
    counts[key] += 1;
    if (samples[key].length < 20) samples[key].push(item);
  };

  if (document.documentElement.scrollWidth > viewportWidth + 1) {
    push('horizontal_scroll', {
      tag: 'document',
      text: 'page scrolls sideways',
      width: document.documentElement.scrollWidth,
    });
  }

  const seenText = new Set<string>();
  document.body.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 && rect.height < 1) return;

    const text = Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text && text.length < 80) {
      const fontSize = parseFloat(style.fontSize);
      const key = `${el.tagName}:${fontSize}:${text}`;
      if (fontSize > 0 && fontSize < 12 && !seenText.has(key)) {
        seenText.add(key);
        push('text_under_12px', { tag: el.tagName.toLowerCase(), text, fontSize });
      }
    }

    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isControl =
      tag === 'button' ||
      tag === 'select' ||
      tag === 'textarea' ||
      (tag === 'input' && !['hidden', 'checkbox', 'radio', 'range', 'file'].includes(type)) ||
      role === 'button';
      if (isControl && rect.height >= 1) {
      const item = {
        tag,
        text: (el.textContent || el.getAttribute('aria-label') || type || tag).replace(/\s+/g, ' ').trim().slice(0, 80),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      const isListRow = tag === 'button' && rect.width > 250;
      if (rect.height > 52 && tag !== 'textarea' && !isListRow) push('control_too_tall', item);
      if (rect.height < 32) push('control_too_short', item);
      if (tag === 'button' && rect.width > viewportWidth * 0.9) push('wide_button', item);
    }

    if (rect.right > viewportWidth + 1 && !isDecorative(el)) {
      let parent: HTMLElement | null = el.parentElement;
      let inScroller = false;
      while (parent) {
        const overflow = getComputedStyle(parent).overflowX;
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') {
          inScroller = true;
          break;
        }
        parent = parent.parentElement;
      }
      const parentRight = el.parentElement?.getBoundingClientRect().right ?? 0;
      if (!inScroller && parentRight <= viewportWidth + 1) {
        push('overflow_right', {
          tag,
          text: (text || el.id || String(el.className || tag)).slice(0, 80),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        });
      }
    }
  });

  return { counts, samples };
}
