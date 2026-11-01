import sanitizeHtml from 'sanitize-html';

const COLOR = /^[#a-z0-9(),.\s%]+$/i;
const LENGTH = /^-?[\d.]+(px|pt|em|rem|mm|cm|%)?$/;
const BOX = /^(-?[\d.]+(px|pt|em|rem|mm|cm|%)?\s*){1,4}$/;

/**
 * HR letter templates are written by business users and rendered both in the app and by
 * headless Chrome for PDFs. Only formatting markup survives: no scripts, frames, forms,
 * event handlers or remote embeds (which Chrome would fetch from the server's network).
 */
export function sanitizeDocumentTemplateHtml(dirty: string): string {
  const source = dirty.length > 200_000 ? dirty.slice(0, 200_000) : dirty;
  return sanitizeHtml(source, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'div', 'span', 'strong', 'em', 'b', 'i',
      'u', 's', 'sub', 'sup', 'small', 'blockquote', 'ul', 'ol', 'li', 'a', 'img',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption',
    ],
    allowedAttributes: {
      '*': ['style', 'align', 'class'],
      a: ['href'],
      img: ['src', 'alt', 'width', 'height'],
      th: ['colspan', 'rowspan', 'width'],
      td: ['colspan', 'rowspan', 'width'],
      col: ['span', 'width'],
      table: ['width', 'border', 'cellpadding', 'cellspacing'],
    },
    // Inline styles may not load anything (no url(), no @import).
    allowedStyles: {
      '*': {
        color: [COLOR],
        'background-color': [COLOR],
        'text-align': [/^(left|right|center|justify)$/],
        'font-size': [LENGTH],
        'font-weight': [/^(normal|bold|bolder|lighter|\d{3})$/],
        'font-style': [/^(normal|italic)$/],
        'font-family': [/^[a-z0-9\s,'"-]+$/i],
        'text-decoration': [/^[a-z\s-]+$/i],
        'line-height': [LENGTH],
        margin: [BOX],
        'margin-top': [LENGTH],
        'margin-bottom': [LENGTH],
        'margin-left': [LENGTH],
        'margin-right': [LENGTH],
        padding: [BOX],
        border: [/^[\d.]+px\s+(solid|dashed|dotted)\s+[#a-z0-9(),.\s%]+$/i],
        'border-collapse': [/^(collapse|separate)$/],
        width: [LENGTH],
        'vertical-align': [/^(top|middle|bottom|baseline)$/],
      },
    },
    allowedSchemes: ['https', 'mailto', 'tel'],
    // Images only as inline data, so rendering never makes a network request.
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
  });
}

/** Escape a merge-field value for HTML text or a double-quoted attribute. */
export function escapeDocumentValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
