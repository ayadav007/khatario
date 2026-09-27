export type FrontmatterValue = string | string[] | boolean | number | null;

export interface ParsedMarkdown {
  data: Record<string, FrontmatterValue>;
  body: string;
}

function parseScalar(raw: string): FrontmatterValue {
  const v = raw.trim();
  if (v === '' || v === '~' || v === 'null') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    return v
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }
  return v;
}

/** Minimal YAML frontmatter: `key: value`, inline `[a, b]` lists and `- item` block lists. */
export function parseFrontmatter(source: string): ParsedMarkdown {
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: text };

  const header = text.slice(4, end);
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  const data: Record<string, FrontmatterValue> = {};
  let listKey: string | null = null;

  for (const line of header.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const current = Array.isArray(data[listKey]) ? (data[listKey] as string[]) : [];
      current.push(String(parseScalar(item[1]) ?? ''));
      data[listKey] = current;
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value.trim() === '') {
      listKey = key;
      data[key] = [];
    } else {
      listKey = null;
      data[key] = parseScalar(value);
    }
  }
  return { data, body };
}

export function asStringArray(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string' && value) return [value];
  return [];
}

export function asString(value: FrontmatterValue | undefined): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}
