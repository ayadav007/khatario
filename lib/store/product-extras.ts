export type StoreTab = { title: string; body: string };
export type SizeChart = { columns: string[]; rows: string[][] };

export type ProductExtrasResult =
  | { ok: true; value: { video_url?: string | null; store_tabs?: StoreTab[]; size_chart?: SizeChart | null } }
  | { ok: false; error: string };

const MAX_TABS = 4;
const MAX_TAB_TITLE = 40;
const MAX_TAB_BODY = 4000;
const MAX_COLUMNS = 8;
const MAX_ROWS = 20;
const MAX_CELL = 40;
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

function parseHttps(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

export type VideoEmbed = { kind: 'youtube'; src: string } | { kind: 'file'; src: string };

/** Safe embed for a product video, or null when the link is not an allowed one. */
export function videoEmbed(url: string | null | undefined): VideoEmbed | null {
  if (!url) return null;
  const u = parseHttps(url.trim());
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] || null;
  } else if (host === 'youtube.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'watch') id = u.searchParams.get('v');
    else if (parts[0] === 'shorts' || parts[0] === 'embed') id = parts[1] ?? null;
  }
  if (id !== null || host === 'youtu.be' || host === 'youtube.com') {
    return id && YT_ID.test(id)
      ? { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}` }
      : null;
  }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: 'file', src: u.toString() };
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function validateTabs(raw: unknown): { value: StoreTab[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Tabs must be a list.' };
  const tabs: StoreTab[] = [];
  for (const t of raw) {
    if (!isObj(t)) return { error: 'Each tab needs a title and some text.' };
    const title = typeof t.title === 'string' ? t.title.trim() : '';
    const body = typeof t.body === 'string' ? t.body.trim() : '';
    if (!title && !body) continue;
    if (!title) return { error: 'Each tab needs a title.' };
    if (!body) return { error: `Tab "${title}" needs some text.` };
    if (title.length > MAX_TAB_TITLE) return { error: `Tab titles can be up to ${MAX_TAB_TITLE} characters.` };
    if (body.length > MAX_TAB_BODY) return { error: `Tab text can be up to ${MAX_TAB_BODY} characters.` };
    tabs.push({ title, body });
  }
  if (tabs.length > MAX_TABS) return { error: `You can add up to ${MAX_TABS} tabs.` };
  return { value: tabs };
}

function validateChart(raw: unknown): { value: SizeChart } | { error: string } {
  if (!isObj(raw) || !Array.isArray(raw.columns) || !Array.isArray(raw.rows)) {
    return { error: 'The size chart needs columns and rows.' };
  }
  const columns: string[] = [];
  for (const c of raw.columns) {
    if (typeof c !== 'string') return { error: 'Size chart columns must be text.' };
    columns.push(c.trim());
  }
  if (columns.length === 0) return { error: 'The size chart needs at least one column.' };
  if (columns.length > MAX_COLUMNS) return { error: `A size chart can have up to ${MAX_COLUMNS} columns.` };
  if (raw.rows.length > MAX_ROWS) return { error: `A size chart can have up to ${MAX_ROWS} rows.` };
  const rows: string[][] = [];
  for (const r of raw.rows) {
    if (!Array.isArray(r) || r.length !== columns.length) {
      return { error: 'Every size chart row must have one cell per column.' };
    }
    const cells: string[] = [];
    for (const cell of r) {
      if (typeof cell !== 'string') return { error: 'Size chart cells must be text.' };
      cells.push(cell.trim());
    }
    rows.push(cells);
  }
  if ([...columns, ...rows.flat()].some((c) => c.length > MAX_CELL)) {
    return { error: `Size chart cells can be up to ${MAX_CELL} characters.` };
  }
  return { value: { columns, rows } };
}

/** Validates only the keys present in `body`; returns the cleaned values or the first error. */
export function validateProductExtras(body: unknown): ProductExtrasResult {
  const src = isObj(body) ? body : {};
  const value: { video_url?: string | null; store_tabs?: StoreTab[]; size_chart?: SizeChart | null } = {};

  if ('video_url' in src) {
    const raw = src.video_url;
    if (raw === null || raw === undefined) {
      value.video_url = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, error: 'The video link must be text.' };
    } else {
      const url = raw.trim();
      if (!url) {
        value.video_url = null;
      } else if (!videoEmbed(url)) {
        return {
          ok: false,
          error: 'Use an https YouTube link, or an https link to an .mp4 or .webm file.',
        };
      } else {
        value.video_url = url;
      }
    }
  }

  if ('store_tabs' in src) {
    const r = validateTabs(src.store_tabs ?? []);
    if ('error' in r) return { ok: false, error: r.error };
    value.store_tabs = r.value;
  }

  if ('size_chart' in src) {
    if (src.size_chart === null || src.size_chart === undefined) {
      value.size_chart = null;
    } else {
      const r = validateChart(src.size_chart);
      if ('error' in r) return { ok: false, error: r.error };
      value.size_chart = r.value;
    }
  }

  return { ok: true, value };
}
