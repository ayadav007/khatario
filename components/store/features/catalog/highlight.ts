/** Splits `text` around the first case-insensitive match of `q` so the match can be bolded. */
export function splitHighlight(text: string, q: string): { text: string; match: boolean }[] {
  const needle = q.trim();
  if (!needle) return [{ text, match: false }];
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return [{ text, match: false }];
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + needle.length), match: true },
    { text: text.slice(at + needle.length), match: false },
  ].filter((p) => p.text);
}
