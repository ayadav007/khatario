export type LegalTextPart = string | { label: string; href: string };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function isSafeHref(href: string): boolean {
  return /^\/[^/]/.test(href) || href.startsWith('mailto:');
}

/** Splits text containing [label](href) into plain strings and link parts. Unsafe hrefs stay as plain text. */
export function splitLegalLinks(text: string): LegalTextPart[] {
  const parts: LegalTextPart[] = [];
  let last = 0;
  const push = (s: string) => {
    if (!s) return;
    const prev = parts[parts.length - 1];
    if (typeof prev === 'string') parts[parts.length - 1] = prev + s;
    else parts.push(s);
  };
  for (const match of text.matchAll(LINK)) {
    const index = match.index ?? 0;
    push(text.slice(last, index));
    if (isSafeHref(match[2])) parts.push({ label: match[1], href: match[2] });
    else push(match[0]);
    last = index + match[0].length;
  }
  push(text.slice(last));
  return parts;
}
