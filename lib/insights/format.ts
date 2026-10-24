export interface InsightRow {
  label: string;
  value: string;
  hint?: string;
}

export interface InsightCard {
  title: string;
  subtitle?: string;
  rows: InsightRow[];
  /** Shown when there is nothing to list, e.g. "No customer owes you money". */
  empty?: string;
  link?: { label: string; url: string };
}

export type TextFormat = 'chat' | 'whatsapp';

export function inr(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}₹${Math.abs(rounded).toLocaleString('en-IN')}`;
}

export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? singular : plural}`;
}

/** "up 12% vs yesterday" / "down 5% vs ..." / null when the earlier value is zero. */
export function change(current: number, previous: number, prevLabel: string): string | null {
  if (!previous) return current ? `none ${prevLabel}` : null;
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100);
  if (pct === 0) return `same as ${prevLabel}`;
  return `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}% vs ${prevLabel}`;
}

export function shorten(text: string, max = 28): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function cardText(card: InsightCard, format: TextFormat, appUrl: string): string {
  const bold = (s: string) => (format === 'whatsapp' ? `*${s}*` : `**${s}**`);
  const lines = [bold(card.title)];
  if (card.subtitle) lines.push(card.subtitle);
  if (!card.rows.length && card.empty) lines.push(card.empty);
  for (const r of card.rows) {
    const hint = r.hint ? ` (${r.hint})` : '';
    lines.push(format === 'whatsapp' ? `${r.label}: ${r.value}${hint}` : `- ${r.label}: ${r.value}${hint}`);
  }
  if (format === 'whatsapp' && card.link && appUrl) lines.push(`${card.link.label}: ${appUrl}${card.link.url}`);
  return lines.join('\n');
}

/** Text version of the cards: the chat bubble (cards render below it) or the whole WhatsApp reply. */
export function renderCards(cards: InsightCard[], format: TextFormat, appUrl = ''): string {
  return cards.map((c) => cardText(c, format, appUrl)).join('\n\n');
}

/** Chat markdown to WhatsApp text: **bold** to *bold*, no [n] citation markers or headings. */
export function toWhatsAppText(markdown: string): string {
  return markdown
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/^#{1,6}\s+(.*)$/gm, '*$1*')
    .replace(/ ?\[(\d+)\](?!\()/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 ($2)')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
}
