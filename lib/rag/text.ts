/** English + common Hinglish filler words that carry no retrieval signal. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'am', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'i', 'me', 'my',
  'we', 'our', 'you', 'your', 'it', 'its', 'this', 'that', 'these', 'those', 'to', 'of', 'in', 'on', 'for',
  'with', 'and', 'or', 'but', 'if', 'at', 'by', 'from', 'as', 'can', 'could', 'will', 'would', 'should',
  'how', 'what', 'which', 'who', 'when', 'where', 'why', 'there', 'here', 'about', 'any', 'some', 'so',
  'please', 'pls', 'plz', 'tell', 'know', 'want', 'need', 'get', 'have', 'has', 'had', 'use', 'using',
  'khatario', 'hi', 'hello', 'hey', 'thanks', 'thank', 'ok', 'okay', 'yes', 'no',
  'hai', 'hain', 'ho', 'kya', 'kaise', 'kaisa', 'kaisi', 'kab', 'kahan', 'kyu', 'kyun', 'ka', 'ki', 'ke',
  'ko', 'se', 'me', 'mein', 'mai', 'main', 'mujhe', 'muje', 'hum', 'humein', 'aap', 'apna', 'apni', 'apne',
  'yeh', 'ye', 'woh', 'wo', 'bhi', 'toh', 'to', 'na', 'nahi', 'nahin', 'haan', 'ji', 'kar', 'karo', 'karna',
  'karte', 'karta', 'karti', 'sakta', 'sakte', 'sakti', 'hota', 'hoti', 'hote', 'raha', 'rahe', 'rahi',
  'bhai', 'sir', 'madam', 'batao', 'bataiye', 'btao', 'chahiye', 'chahta', 'chahte', 'wala', 'wali', 'wale',
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function isStopword(token: string): boolean {
  return STOPWORDS.has(token);
}

/** Safe token for to_tsquery: letters/digits only (Latin or Devanagari). */
export function tsToken(token: string): string | null {
  const clean = token.replace(/[^a-z0-9\u0900-\u097F]/g, '');
  return clean.length > 1 ? clean : null;
}
