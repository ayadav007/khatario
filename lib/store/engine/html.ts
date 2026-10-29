import sanitizeHtml from 'sanitize-html';

export const CUSTOM_HTML_MAX = 20000;

const IFRAME_PREFIXES = [
  'https://www.youtube.com/embed/',
  'https://www.youtube-nocookie.com/embed/',
  'https://www.google.com/maps/embed',
];

const UNSAFE_STYLE_RE = /\|url\s*\(|expression\s*\(|@import|javascript:|behaviou?r\s*:|-moz-binding/i;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'a', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption', 'blockquote',
    'strong', 'em', 'br', 'hr', 'section', 'iframe',
  ],
  allowedAttributes: {
    '*': ['class', 'style'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    iframe: ['src', 'width', 'height', 'title', 'allowfullscreen', 'sandbox', 'loading'],
  },
  allowedSchemes: ['https', 'http', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['https'], iframe: ['https'] },
  allowProtocolRelative: false,
  allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'www.google.com'],
  transformTags: {
    '*': (tagName, attribs) => {
      const next = { ...attribs };
      // Inline styles are kept, but a value that can fetch or execute something drops the whole attribute.
      if (next.style && UNSAFE_STYLE_RE.test(next.style.replace(/\/\*.*?\*\//g, ''))) delete next.style;
      if (tagName === 'iframe') {
        next.sandbox = 'allow-scripts allow-same-origin allow-presentation';
        next.loading = 'lazy';
      }
      return { tagName, attribs: next };
    },
  },
  exclusiveFilter: (frame) => {
    if (frame.tag === 'iframe') {
      const src = frame.attribs.src || '';
      return !IFRAME_PREFIXES.some((p) => src.startsWith(p));
    }
    return false;
  },
};

export function sanitizeCustomHtml(dirty: unknown): string {
  if (typeof dirty !== 'string') return '';
  return sanitizeHtml(dirty.slice(0, CUSTOM_HTML_MAX), OPTIONS);
}
