import { sanitizeMarketingDocument, MARKETING_DOC_MAX_BYTES } from '@/lib/marketing-builder/sanitize';
import { isSafeHref, isSafeImageSrc, youtubeId } from '@/lib/marketing-builder/safe-url';
import { detectImageType, isMediaFileName } from '@/lib/marketing-builder/media';
import { buildDefaultHomeDocument } from '@/lib/marketing-builder/default-home';
import { KHATARIO_BLOCKS } from '@/lib/marketing-builder/block-types';

const HASH = 'a'.repeat(64);

function doc(content: unknown[], rootProps: Record<string, unknown> = {}) {
  return { root: { props: rootProps }, content };
}

describe('sanitizeMarketingDocument', () => {
  it('accepts the default home document unchanged', () => {
    const input = buildDefaultHomeDocument();
    const result = sanitizeMarketingDocument(input);
    expect(result).toEqual({ ok: true, data: input });
  });

  it('default home document lists every Khatario section once', () => {
    const types = buildDefaultHomeDocument().content.map((c) => c.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...KHATARIO_BLOCKS].sort());
  });

  it('rejects unknown block types', () => {
    const result = sanitizeMarketingDocument(doc([{ type: 'Script', props: { id: 's1' } }]));
    expect(result).toEqual({ ok: false, error: 'Unknown block type: Script' });
  });

  it('rejects blocks without an id', () => {
    const result = sanitizeMarketingDocument(doc([{ type: 'Heading', props: { text: 'Hi' } }]));
    expect(result.ok).toBe(false);
  });

  it('rejects malformed documents', () => {
    expect(sanitizeMarketingDocument(null).ok).toBe(false);
    expect(sanitizeMarketingDocument({ content: 'nope' }).ok).toBe(false);
    expect(sanitizeMarketingDocument({ root: {}, content: [{ type: 'Heading' }] }).ok).toBe(false);
  });

  it('blanks unsafe links and image sources', () => {
    const result = sanitizeMarketingDocument(
      doc([
        {
          type: 'Buttons',
          props: {
            id: 'b1',
            buttons: [
              { label: 'Bad', href: 'javascript:alert(1)' },
              { label: 'Proto', href: '//evil.example' },
              { label: 'Good', href: '/signup' },
            ],
          },
        },
        { type: 'Image', props: { id: 'i1', image: 'data:image/png;base64,AAAA' } },
        { type: 'Image', props: { id: 'i2', image: `/media/marketing/${HASH}.webp` } },
        { type: 'Video', props: { id: 'v1', videoUrl: 'https://evil.example/x' } },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [buttons, badImg, goodImg, video] = result.data.content;
    expect((buttons.props.buttons as { href: string }[]).map((b) => b.href)).toEqual(['', '', '/signup']);
    expect(badImg.props.image).toBe('');
    expect(goodImg.props.image).toBe(`/media/marketing/${HASH}.webp`);
    expect(video.props.videoUrl).toBe('');
  });

  it('recurses into slots and still validates nested blocks', () => {
    const nested = doc([
      {
        type: 'Section',
        props: {
          id: 's1',
          content: [{ type: 'Card', props: { id: 'c1', content: [{ type: 'Text', props: { id: 't1', text: 'ok' } }] } }],
        },
      },
    ]);
    expect(sanitizeMarketingDocument(nested).ok).toBe(true);

    const bad = doc([
      { type: 'Section', props: { id: 's1', content: [{ type: 'Iframe', props: { id: 'x' } }] } },
    ]);
    expect(sanitizeMarketingDocument(bad)).toEqual({ ok: false, error: 'Unknown block type: Iframe' });
  });

  it('drops prototype-pollution keys', () => {
    const raw = JSON.parse(
      '{"root":{"props":{"__proto__":{"polluted":true}}},"content":[{"type":"Text","props":{"id":"t1","constructor":"x","text":"hi"}}]}',
    );
    const result = sanitizeMarketingDocument(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.prototype.hasOwnProperty.call(result.data.root.props, '__proto__')).toBe(false);
    expect(result.data.content[0].props).toEqual({ id: 't1', text: 'hi' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('truncates long strings and caps plain arrays', () => {
    const result = sanitizeMarketingDocument(
      doc([
        {
          type: 'IconList',
          props: { id: 'l1', title: 'x'.repeat(6000), items: Array.from({ length: 150 }, (_, i) => ({ text: `i${i}` })) },
        },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data.content[0].props.title as string).length).toBe(5000);
    expect((result.data.content[0].props.items as unknown[]).length).toBe(100);
  });

  it('rejects documents over the size limit', () => {
    const big = 'x'.repeat(4000);
    const content = Array.from({ length: Math.ceil(MARKETING_DOC_MAX_BYTES / 4000) + 5 }, (_, i) => ({
      type: 'Text',
      props: { id: `t${i}`, text: big },
    }));
    expect(sanitizeMarketingDocument(doc(content)).ok).toBe(false);
  });

  it('rejects documents nested too deeply', () => {
    let inner: unknown = { type: 'Text', props: { id: 'leaf', text: 'x' } };
    for (let i = 0; i < 20; i++) inner = { type: 'Card', props: { id: `c${i}`, content: [inner] } };
    expect(sanitizeMarketingDocument(doc([inner])).ok).toBe(false);
  });
});

describe('safe-url', () => {
  it.each([
    ['', true],
    ['#pricing', true],
    ['/book-demo', true],
    ['https://wa.me/919999999999', true],
    ['mailto:hello@example.com', true],
    ['tel:+91 99999 99999', true],
    ['javascript:alert(1)', false],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['data:text/html,hi', false],
    ['#bad"onmouseover', false],
  ])('isSafeHref(%p) is %p', (value, expected) => {
    expect(isSafeHref(value)).toBe(expected);
  });

  it.each([
    [`/media/marketing/${HASH}.webp`, true],
    ['/marketing/screens/dashboard.webp', true],
    ['https://images.example.com/a.jpg', true],
    ['http://images.example.com/a.jpg', false],
    ['/marketing/../../etc/passwd.png', false],
    ['/media/marketing/../secret.webp', false],
    ['javascript:alert(1)', false],
  ])('isSafeImageSrc(%p) is %p', (value, expected) => {
    expect(isSafeImageSrc(value)).toBe(expected);
  });

  it('extracts YouTube ids only from YouTube URLs', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
  });
});

describe('marketing media names and types', () => {
  it('accepts only content-hash webp names', () => {
    expect(isMediaFileName(`${HASH}.webp`)).toBe(true);
    expect(isMediaFileName(`${HASH}.png`)).toBe(false);
    expect(isMediaFileName(`../${HASH}.webp`)).toBe(false);
    expect(isMediaFileName(`${'A'.repeat(64)}.webp`)).toBe(false);
    expect(isMediaFileName('index.webp')).toBe(false);
  });

  it('detects image formats from magic bytes', () => {
    const pad = (bytes: number[]) => Buffer.concat([Buffer.from(bytes), Buffer.alloc(16)]);
    expect(detectImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(detectImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))).toBe('webp');
    expect(detectImageType(Buffer.from('\0\0\0\x1cftypavif\0\0\0\0', 'binary'))).toBe('avif');
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
  });
});
