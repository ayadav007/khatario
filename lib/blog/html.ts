import sanitizeHtml from 'sanitize-html';

const ALIGN = new Set(['left', 'center', 'right', 'full']);
const SIZE = new Set(['small', 'medium', 'large', 'original']);
const MEDIA_SRC = /^\/media\/marketing\/[a-f0-9]{64}\.webp$/;

export function isAllowedImageSrc(value: string): boolean {
  const src = value.trim();
  if (!src) return false;
  if (MEDIA_SRC.test(src)) return true;
  try {
    const url = new URL(src);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function attr(source: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(source);
  return match ? decodeAttr(match[1]) : '';
}

function normalizeWrap(align: string, size: string, wrap: string): string {
  if (size !== 'small') return 'none';
  if (wrap === 'left' && align === 'left') return 'left';
  if (wrap === 'right' && align === 'right') return 'right';
  return 'none';
}

function figureHtml(src: string, alt: string, caption: string, align: string, size: string, wrap: string): string {
  const safeAlign = ALIGN.has(align) ? align : 'center';
  const safeSize = SIZE.has(size) ? size : 'large';
  const safeWrap = normalizeWrap(safeAlign, safeSize, wrap);
  const cap = caption.trim();
  const captionHtml = cap ? `<figcaption>${esc(cap)}</figcaption>` : '';
  return `<figure class="blog-figure" data-align="${safeAlign}" data-size="${safeSize}" data-wrap="${safeWrap}"><img src="${esc(src)}" alt="${esc(alt)}">${captionHtml}</figure>`;
}

function normalizeFigures(html: string): string {
  const withFigures = html.replace(/<img\b[^>]*>/gi, (match, offset: number) => {
    const head = html.slice(Math.max(0, offset - 120), offset);
    const open = head.lastIndexOf('<figure');
    const close = head.lastIndexOf('</figure');
    if (open > close) return match;
    return `<figure class="blog-figure" data-align="center" data-size="large" data-wrap="none">${match}</figure>`;
  });

  return withFigures.replace(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi, (_all, figureAttrs: string, inner: string) => {
    const img = /<img\b([^>]*)>/i.exec(inner);
    if (!img) return '';
    const src = attr(img[1], 'src');
    if (!isAllowedImageSrc(src)) return '';
    const alt = attr(img[1], 'alt');
    const caption = decodeAttr((/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner)?.[1] || '').replace(/<[^>]+>/g, ''));
    return figureHtml(src, alt, caption, attr(figureAttrs, 'data-align'), attr(figureAttrs, 'data-size'), attr(figureAttrs, 'data-wrap'));
  });
}

export function sanitizeBlogHtml(dirty: string): string {
  const source = dirty.length > 200_000 ? dirty.slice(0, 200_000) : dirty;
  const cleaned = sanitizeHtml(source, {
    allowedTags: [
      'h1', 'h2', 'h3', 'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
      'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'pre', 'code',
    ],
    allowedAttributes: {
      a: ['href', 'rel', 'target'],
      img: ['src', 'alt'],
      figure: ['class', 'data-align', 'data-size', 'data-wrap'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    },
    allowedClasses: { figure: ['blog-figure'] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['https', 'http'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    exclusiveFilter(frame) {
      if (frame.tag === 'img') return !isAllowedImageSrc(frame.attribs.src || '');
      if (frame.tag === 'a') {
        const href = frame.attribs.href || '';
        if (!href) return true;
        if (href.startsWith('/') && !href.startsWith('//') && !/[\s\\]/.test(href)) return false;
        if (/^(mailto:|tel:)/i.test(href)) return false;
        try {
          const url = new URL(href);
          return url.protocol !== 'https:' && url.protocol !== 'http:';
        } catch {
          return true;
        }
      }
      return false;
    },
    transformTags: {
      a: (_tag, attribs) => {
        const href = attribs.href || '';
        const external = /^https?:/i.test(href);
        return {
          tagName: 'a',
          attribs: {
            href,
            ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
          },
        };
      },
    },
  });
  return normalizeFigures(cleaned);
}

export function articleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function articleHasBody(html: string): boolean {
  return articleText(html).length > 0 || /<img\b/i.test(html);
}
