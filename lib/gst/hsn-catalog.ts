import fs from 'fs';
import path from 'path';

export interface HsnCatalogRow {
  code: string;
  description: string;
  isService: boolean;
}

type StoredRow = [string, string, number];

/** Trade words the tariff does not use. The official description is still what we show. */
const TRADE_NAMES: Record<string, string> = {
  '847130': 'laptop laptops notebook',
  '851713': 'mobile cellphone smartphone phone',
  '85171300': 'mobile cellphone smartphone phone',
};

let catalog: HsnCatalogRow[] | null = null;

function loadCatalog(): HsnCatalogRow[] {
  if (catalog) return catalog;
  const filePath = path.join(process.cwd(), 'data', 'hsn-sac-codes.json');
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StoredRow[];
  catalog = stored.map(([code, description, service]) => ({
    code,
    description,
    isService: service === 1,
  }));
  return catalog;
}

function hasWordPrefix(text: string, term: string): boolean {
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(term, from);
    if (at < 0) return false;
    const previous = at === 0 ? ' ' : text[at - 1];
    if (!/[a-z0-9]/.test(previous)) return true;
    from = at + 1;
  }
  return false;
}

/**
 * Search the official GST HSN/SAC list shipped with the app.
 * A two-letter query matches the start of a word, not letters buried inside another word.
 */
export function searchHsnCatalog(query: string, limit = 10): HsnCatalogRow[] {
  const term = query.trim().toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (term.length < 2) return [];
  const rows = loadCatalog();
  const codeSearch = /^\d+$/.test(term);
  const ranked: { row: HsnCatalogRow; score: number }[] = [];

  for (const row of rows) {
    if (codeSearch) {
      if (!row.code.startsWith(term)) continue;
      ranked.push({ row, score: row.code === term ? 0 : 1 });
      continue;
    }

    const description = row.description.toLowerCase();
    const trade = TRADE_NAMES[row.code] || '';
    let score = 3;
    if (description.startsWith(term) || hasWordPrefix(trade, term)) score = 0;
    else if (hasWordPrefix(description, term)) score = 1;
    else if (description.includes(term) || trade.includes(term)) score = 2;
    else continue;
    ranked.push({ row, score });
  }

  ranked.sort((a, b) => a.score - b.score || a.row.code.length - b.row.code.length || a.row.code.localeCompare(b.row.code));
  return ranked.slice(0, limit).map((entry) => entry.row);
}
