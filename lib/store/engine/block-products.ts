const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BLOCK_PRODUCTS = 12;

/** The product ids picked in blocks of one type: UUID-looking, deduplicated, in block order, at most 12. */
export function blockProductIds(
  blocks: Array<{ type: string; settings: Record<string, unknown> }>,
  blockType: string,
  settingId = 'product',
): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type !== blockType) continue;
    const id = b.settings[settingId];
    if (typeof id === 'string' && UUID_RE.test(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_BLOCK_PRODUCTS) break;
  }
  return out;
}
