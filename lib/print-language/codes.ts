export const DOCUMENT_LANGUAGE_CODES = [
  'en',
  'hi',
  'hinglish',
  'mr',
  'gu',
  'ta',
  'te',
  'kn',
  'ml',
  'bn',
  'pa',
  'or',
  'ur',
] as const;

export type DocumentLanguage = (typeof DOCUMENT_LANGUAGE_CODES)[number];

export const DOCUMENT_LANGUAGES: ReadonlyArray<{
  code: DocumentLanguage;
  label: string;
  native: string;
}> = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'hinglish', label: 'Hinglish', native: 'Hinglish' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'ur', label: 'Urdu', native: 'اردو' },
];

const CODE_SET = new Set<string>(DOCUMENT_LANGUAGE_CODES);

export function normalizeDocumentLanguage(value: unknown): DocumentLanguage {
  const code = String(value ?? '').trim().toLowerCase();
  return CODE_SET.has(code) ? (code as DocumentLanguage) : 'en';
}

/** Plan matrix off means every document prints in English, even if another language was saved. */
export function applyDocumentLanguageEntitlement(
  language: DocumentLanguage,
  allowed: boolean,
): DocumentLanguage {
  return allowed ? language : 'en';
}

/** BCP 47 tag for dates on the printout. Hinglish keeps English month names. */
export function documentLanguageDateLocale(language: DocumentLanguage): string {
  switch (language) {
    case 'hi':
      return 'hi-IN';
    case 'mr':
      return 'mr-IN';
    case 'gu':
      return 'gu-IN';
    case 'ta':
      return 'ta-IN';
    case 'te':
      return 'te-IN';
    case 'kn':
      return 'kn-IN';
    case 'ml':
      return 'ml-IN';
    case 'bn':
      return 'bn-IN';
    case 'pa':
      return 'pa-IN';
    case 'or':
      return 'or-IN';
    case 'ur':
      return 'ur-IN';
    default:
      return 'en-IN';
  }
}

const FONT_STACK: Partial<Record<DocumentLanguage, string>> = {
  hi: '"Nirmala UI","Mangal","Noto Sans Devanagari",sans-serif',
  mr: '"Nirmala UI","Mangal","Noto Sans Devanagari",sans-serif',
  gu: '"Nirmala UI","Shruti","Noto Sans Gujarati",sans-serif',
  ta: '"Nirmala UI","Noto Sans Tamil","Latha",sans-serif',
  te: '"Nirmala UI","Noto Sans Telugu","Gautami",sans-serif',
  kn: '"Nirmala UI","Noto Sans Kannada","Tunga",sans-serif',
  ml: '"Nirmala UI","Noto Sans Malayalam","Kartika",sans-serif',
  bn: '"Nirmala UI","Noto Sans Bengali","Vrinda",sans-serif',
  pa: '"Nirmala UI","Noto Sans Gurmukhi","Raavi",sans-serif',
  or: '"Nirmala UI","Noto Sans Oriya","Kalinga",sans-serif',
  ur: '"Nirmala UI","Noto Nastaliq Urdu","Aldhabi","Noto Sans Arabic",sans-serif',
};

export function printFontStack(language: DocumentLanguage): string | null {
  return FONT_STACK[language] ?? null;
}
