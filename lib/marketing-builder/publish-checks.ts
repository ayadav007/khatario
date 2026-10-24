import type { MarketingDocument } from '@/lib/marketing-builder/sanitize';

const ALT_BLOCKS = new Set(['Image', 'Screenshot']);

function eachBlock(nodes: unknown, visit: (type: string, props: Record<string, unknown>) => void): void {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const block = node as { type?: unknown; props?: unknown };
    if (typeof block.type !== 'string' || !block.props || typeof block.props !== 'object') continue;
    const props = block.props as Record<string, unknown>;
    visit(block.type, props);
    for (const value of Object.values(props)) eachBlock(value, visit);
  }
}

/** Images that will render need alt text. Drafts may omit it; publish may not. */
export function imageAltPublishError(doc: MarketingDocument): string | null {
  let missing = 0;
  const seen = new Set<string>();
  const scan = (nodes: unknown) => {
    eachBlock(nodes, (type, props) => {
      if (!ALT_BLOCKS.has(type)) return;
      const id = typeof props.id === 'string' ? props.id : '';
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      const src = typeof props.image === 'string' ? props.image.trim() : '';
      const alt = typeof props.alt === 'string' ? props.alt.trim() : '';
      if (src && !alt) missing += 1;
    });
  };
  scan(doc.content);
  if (doc.zones) {
    for (const items of Object.values(doc.zones)) scan(items);
  }
  if (missing === 0) return null;
  if (missing === 1) {
    return 'Add alt text to the image before publishing. Alt text is what Google and screen readers use.';
  }
  return `Add alt text to ${missing} images before publishing.`;
}
