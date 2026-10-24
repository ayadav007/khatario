jest.mock('jose', () => ({
  SignJWT: jest.fn(),
  jwtVerify: jest.fn(),
}));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/admin/blog/route';
import { isAllowedImageSrc, sanitizeBlogHtml } from '@/lib/blog/html';
import { isValidSlug, suggestSlug } from '@/lib/blog/slug';
import { parseBlogWrite } from '@/lib/blog/validate';
import { nextPublication, previousSlugToRedirect } from '@/lib/blog/workflow';

const MEDIA = `/media/marketing/${'a'.repeat(64)}.webp`;

describe('blog workflow', () => {
  const now = '2026-10-18T00:00:00.000Z';

  it('keeps a draft unpublished when saving', () => {
    expect(nextPublication(null, 'save', now)).toEqual({ status: 'draft', published_at: null });
    expect(nextPublication({ status: 'draft', published_at: null }, 'save', now)).toEqual({
      status: 'draft',
      published_at: null,
    });
  });

  it('sets the publication time only on the first publish', () => {
    expect(nextPublication({ status: 'draft', published_at: null }, 'publish', now)).toEqual({
      status: 'published',
      published_at: now,
    });
    expect(nextPublication({ status: 'published', published_at: now }, 'save', '2026-11-01T00:00:00.000Z')).toEqual({
      status: 'published',
      published_at: now,
    });
  });

  it('unpublishes without clearing the original timestamp', () => {
    expect(nextPublication({ status: 'published', published_at: now }, 'unpublish', '2026-11-01T00:00:00.000Z')).toEqual({
      status: 'draft',
      published_at: now,
    });
  });

  it('records a redirect only after a published slug changes', () => {
    expect(previousSlugToRedirect({ slug: 'old', published_at: now }, 'new')).toBe('old');
    expect(previousSlugToRedirect({ slug: 'old', published_at: null }, 'new')).toBeNull();
    expect(previousSlugToRedirect({ slug: 'same', published_at: now }, 'same')).toBeNull();
  });
});

describe('blog slugs', () => {
  it('suggests a unique-safe slug and blocks reserved words', () => {
    expect(suggestSlug('GST Bills & Stock!')).toBe('gst-bills-and-stock');
    expect(isValidSlug('gst-bills')).toBe(true);
    expect(isValidSlug('category')).toBe(false);
    expect(isValidSlug('Bad Slug')).toBe(false);
  });
});

describe('blog html', () => {
  it('strips scripts, event handlers, and javascript links', () => {
    const html = sanitizeBlogHtml(
      '<p>Hello</p><script>alert(1)</script><img src="https://cdn.example.com/a.png" onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
    );
    expect(html).toContain('Hello');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://cdn.example.com/a.png');
  });

  it('keeps layout attributes and only wraps small images', () => {
    const html = sanitizeBlogHtml(
      `<figure class="blog-figure" data-align="left" data-size="small" data-wrap="left"><img src="${MEDIA}" alt="Counter"><figcaption>Shop counter</figcaption></figure>`,
    );
    expect(html).toContain('data-align="left"');
    expect(html).toContain('data-size="small"');
    expect(html).toContain('data-wrap="left"');
    expect(html).toContain('Shop counter');

    const large = sanitizeBlogHtml(
      `<figure data-align="left" data-size="large" data-wrap="left"><img src="${MEDIA}" alt="Wide"></figure>`,
    );
    expect(large).toContain('data-wrap="none"');
  });

  it('centers a pasted image and drops unsafe sources', () => {
    const html = sanitizeBlogHtml(`<p>Before</p><img src="${MEDIA}" alt="Bill">`);
    expect(html).toContain('data-align="center"');
    expect(html).toContain('data-size="large"');
    expect(sanitizeBlogHtml('<img src="javascript:alert(1)" alt="bad">')).not.toContain('<img');
    expect(isAllowedImageSrc(MEDIA)).toBe(true);
    expect(isAllowedImageSrc('http://example.com/a.png')).toBe(false);
  });
});

describe('blog validation', () => {
  it('does not publish an empty draft', () => {
    expect(() => parseBlogWrite({ title: 'Hello', content_html: '<p></p>', author_name: 'Ada' }, 'publish')).toThrow(/content/i);
  });

  it('rejects a non-https canonical URL', () => {
    expect(() => parseBlogWrite({
      title: 'Hello',
      content_html: '<p>Body</p>',
      author_name: 'Ada',
      canonical_url: 'http://example.com/post',
    }, 'publish')).toThrow(/https/);
  });
});

describe('blog admin authorization', () => {
  it('rejects an anonymous listing', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/blog'));
    expect(response.status).toBe(401);
  });
});
