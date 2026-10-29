import sanitizeHtml from 'sanitize-html';

export const CUSTOM_HTML_MAX = 20000;

/** Returns the normalised embed URL, or '' when it is not an allowed embed. */
function normaliseEmbedSrc(src: string): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return '';
  const path = url.pathname;
  const ok =
    ((url.hostname === 'www.youtube.com' || url.hostname === 'www.youtube-nocookie.com') && path.startsWith('/embed/')) ||
    (url.hostname === 'www.google.com' && (path === '/maps/embed' || path.startsWith('/maps/embed/')));
  return ok ? url.href : '';
}

const UNSAFE_STYLE_RE = /\\|url\s*\(|expression\s*\(|@import|javascript:|behaviou?r\s*:|-moz-binding/i;

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
        next.src = normaliseEmbedSrc(next.src || '');
      }
      return { tagName, attribs: next };
    },
  },
  exclusiveFilter: (frame) => {
    if (frame.tag === 'iframe') {
      return !frame.attribs.src;
    }
    return false;
  },
};

export function sanitizeCustomHtml(dirty: unknown): string {
  if (typeof dirty !== 'string') return '';
  return sanitizeHtml(dirty.slice(0, CUSTOM_HTML_MAX), OPTIONS);
}
