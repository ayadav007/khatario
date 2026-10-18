import type { PoolClient } from 'pg';
import { getPool, query, queryOne, queryRows } from '@/lib/db';
import { suggestSlug } from '@/lib/blog/slug';
import { BlogInputError, type BlogWriteInput } from '@/lib/blog/validate';
import { nextPublication, previousSlugToRedirect, type BlogIntent, type BlogStatus } from '@/lib/blog/workflow';

export type BlogMedia = {
  id: string;
  url: string;
  alt_text: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
};

export type BlogTag = { id: string; name: string; slug: string };
export type BlogCategory = { id: string; name: string; slug: string; post_count?: number };

export type AdminBlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content_html: string;
  author_name: string;
  category_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  tags: BlogTag[];
  featured_media: BlogMedia | null;
  og_media: BlogMedia | null;
  seo_title: string;
  meta_description: string;
  focus_keyword: string;
  canonical_url: string;
  status: BlogStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BlogCard = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  author_name: string;
  published_at: string | null;
  category_name: string | null;
  category_slug: string | null;
  image_url: string | null;
  image_alt: string | null;
};

const MEDIA_FIELDS = `id, url, alt_text, width, height, bytes`;

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function media(row: Record<string, unknown> | null, prefix: 'featured' | 'og'): BlogMedia | null {
  if (!row) return null;
  const id = row[`${prefix}_id`];
  const url = row[`${prefix}_url`];
  const alt = row[`${prefix}_alt`];
  const width = row[`${prefix}_width`];
  const height = row[`${prefix}_height`];
  const bytes = row[`${prefix}_bytes`];
  if (typeof id !== 'string' || typeof url !== 'string') return null;
  return {
    id,
    url,
    alt_text: typeof alt === 'string' ? alt : '',
    width: typeof width === 'number' ? width : null,
    height: typeof height === 'number' ? height : null,
    bytes: typeof bytes === 'number' ? bytes : null,
  };
}

const POST_SELECT = `
  SELECT
    p.id, p.title, p.slug, p.excerpt, p.content_html, p.author_name,
    p.category_id, c.name AS category_name, c.slug AS category_slug,
    p.seo_title, p.meta_description, p.focus_keyword, p.canonical_url,
    p.status, p.published_at, p.created_at, p.updated_at,
    fm.id AS featured_id, fm.url AS featured_url, fm.alt_text AS featured_alt,
    fm.width AS featured_width, fm.height AS featured_height, fm.bytes AS featured_bytes,
    om.id AS og_id, om.url AS og_url, om.alt_text AS og_alt,
    om.width AS og_width, om.height AS og_height, om.bytes AS og_bytes
  FROM blog_posts p
  LEFT JOIN blog_categories c ON c.id = p.category_id
  LEFT JOIN blog_media fm ON fm.id = p.featured_media_id
  LEFT JOIN blog_media om ON om.id = p.og_media_id
`;

async function tagsFor(client: PoolClient | null, postId: string): Promise<BlogTag[]> {
  const sql = `
    SELECT t.id, t.name, t.slug
    FROM blog_post_tags pt
    JOIN blog_tags t ON t.id = pt.tag_id
    WHERE pt.post_id = $1
    ORDER BY t.name
  `;
  const result = client ? await client.query<BlogTag>(sql, [postId]) : await query<BlogTag>(sql, [postId]);
  return result.rows;
}

function mapPost(row: Record<string, unknown>, tags: BlogTag[]): AdminBlogPost {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    excerpt: String(row.excerpt ?? ''),
    content_html: String(row.content_html ?? ''),
    author_name: String(row.author_name ?? ''),
    category_id: row.category_id ? String(row.category_id) : null,
    category_name: row.category_name ? String(row.category_name) : null,
    category_slug: row.category_slug ? String(row.category_slug) : null,
    tags,
    featured_media: media(row, 'featured'),
    og_media: media(row, 'og'),
    seo_title: String(row.seo_title ?? ''),
    meta_description: String(row.meta_description ?? ''),
    focus_keyword: String(row.focus_keyword ?? ''),
    canonical_url: String(row.canonical_url ?? ''),
    status: row.status === 'published' ? 'published' : 'draft',
    published_at: iso(row.published_at as Date | string | null),
    created_at: iso(row.created_at as Date | string) || new Date(0).toISOString(),
    updated_at: iso(row.updated_at as Date | string) || new Date(0).toISOString(),
  };
}

async function loadPost(client: PoolClient | null, id: string): Promise<AdminBlogPost | null> {
  const sql = `${POST_SELECT} WHERE p.id = $1`;
  const result = client ? await client.query(sql, [id]) : await query(sql, [id]);
  const row = result.rows[0];
  if (!row) return null;
  return mapPost(row, await tagsFor(client, id));
}

async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

async function assertMedia(client: PoolClient, id: string | null, label: string) {
  if (!id) return;
  const found = await client.query('SELECT id FROM blog_media WHERE id = $1', [id]);
  if (!found.rowCount) throw new BlogInputError(`${label} was not found`, 400);
}

async function resolveCategory(client: PoolClient, input: BlogWriteInput): Promise<string | null> {
  if (input.categoryId) {
    const found = await client.query('SELECT id FROM blog_categories WHERE id = $1', [input.categoryId]);
    if (!found.rowCount) throw new BlogInputError('Category was not found');
    return input.categoryId;
  }
  if (!input.categoryName) return null;
  const slug = suggestSlug(input.categoryName);
  const row = await client.query<{ id: string }>(
    `INSERT INTO blog_categories (name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = blog_categories.name
     RETURNING id`,
    [input.categoryName, slug],
  );
  return row.rows[0].id;
}

async function replaceTags(client: PoolClient, postId: string, tags: string[]) {
  await client.query('DELETE FROM blog_post_tags WHERE post_id = $1', [postId]);
  for (const name of tags) {
    const slug = suggestSlug(name);
    const tag = await client.query<{ id: string }>(
      `INSERT INTO blog_tags (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name, slug],
    );
    await client.query(
      `INSERT INTO blog_post_tags (post_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [postId, tag.rows[0].id],
    );
  }
}

async function assertSlugAvailable(client: PoolClient, slug: string, postId: string | null) {
  const post = await client.query<{ id: string }>(
    'SELECT id FROM blog_posts WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2)',
    [slug, postId],
  );
  if (post.rowCount) throw new BlogInputError('That slug is already used. Choose another.', 409);
  const redirect = await client.query<{ post_id: string }>(
    'SELECT post_id FROM blog_slug_redirects WHERE slug = $1',
    [slug],
  );
  const owner = redirect.rows[0]?.post_id;
  if (owner && owner !== postId) throw new BlogInputError('That slug is already used. Choose another.', 409);
  if (owner && owner === postId) {
    await client.query('DELETE FROM blog_slug_redirects WHERE slug = $1', [slug]);
  }
}

export async function saveBlogPost(args: {
  id?: string;
  adminId: string;
  input: BlogWriteInput;
  intent: BlogIntent;
}): Promise<AdminBlogPost> {
  try {
    return await tx(async (client) => {
      const existing = args.id ? await loadPost(client, args.id) : null;
      if (args.id && !existing) throw new BlogInputError('Article not found', 404);

      await assertSlugAvailable(client, args.input.slug, existing?.id ?? null);
      await assertMedia(client, args.input.featuredMediaId, 'Featured image');
      await assertMedia(client, args.input.ogMediaId, 'Open Graph image');
      const categoryId = await resolveCategory(client, args.input);
      const publication = nextPublication(
        existing ? { status: existing.status, published_at: existing.published_at } : null,
        args.intent,
        new Date().toISOString(),
      );
      const oldSlug = previousSlugToRedirect(
        existing ? { slug: existing.slug, published_at: existing.published_at } : null,
        args.input.slug,
      );

      let id = existing?.id;
      if (!id) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO blog_posts (
             title, slug, excerpt, content_html, featured_media_id, author_name, category_id,
             seo_title, meta_description, focus_keyword, canonical_url, og_media_id,
             status, published_at, created_by, updated_by
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15
           ) RETURNING id`,
          [
            args.input.title, args.input.slug, args.input.excerpt, args.input.contentHtml,
            args.input.featuredMediaId, args.input.authorName, categoryId,
            args.input.seoTitle, args.input.metaDescription, args.input.focusKeyword,
            args.input.canonicalUrl, args.input.ogMediaId,
            publication.status, publication.published_at, args.adminId,
          ],
        );
        id = inserted.rows[0].id;
      } else {
        await client.query(
          `UPDATE blog_posts SET
             title = $2, slug = $3, excerpt = $4, content_html = $5, featured_media_id = $6,
             author_name = $7, category_id = $8, seo_title = $9, meta_description = $10,
             focus_keyword = $11, canonical_url = $12, og_media_id = $13,
             status = $14, published_at = $15, updated_by = $16, updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [
            id, args.input.title, args.input.slug, args.input.excerpt, args.input.contentHtml,
            args.input.featuredMediaId, args.input.authorName, categoryId,
            args.input.seoTitle, args.input.metaDescription, args.input.focusKeyword,
            args.input.canonicalUrl, args.input.ogMediaId,
            publication.status, publication.published_at, args.adminId,
          ],
        );
      }

      if (oldSlug) {
        await client.query(
          `INSERT INTO blog_slug_redirects (slug, post_id) VALUES ($1, $2)
           ON CONFLICT (slug) DO UPDATE SET post_id = EXCLUDED.post_id`,
          [oldSlug, id],
        );
      }
      await replaceTags(client, id, args.input.tags);
      const saved = await loadPost(client, id);
      if (!saved) throw new BlogInputError('Article could not be saved', 500);
      return saved;
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new BlogInputError('That slug is already used. Choose another.', 409);
    }
    throw error;
  }
}

export async function getAdminPost(id: string): Promise<AdminBlogPost | null> {
  return loadPost(null, id);
}

export async function deleteBlogPost(id: string): Promise<boolean> {
  const result = await query('DELETE FROM blog_posts WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function listAdminPosts(args: { status?: BlogStatus | null; q?: string; page: number; pageSize: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (args.status) {
    params.push(args.status);
    where.push(`p.status = $${params.length}`);
  }
  if (args.q) {
    params.push(likeTerm(args.q));
    where.push(`(p.title ILIKE $${params.length} ESCAPE '\\' OR p.excerpt ILIKE $${params.length} ESCAPE '\\' OR p.slug ILIKE $${params.length} ESCAPE '\\')`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await queryOne<{ count: string }>(`SELECT COUNT(*)::text AS count FROM blog_posts p ${clause}`, params);
  const offset = (args.page - 1) * args.pageSize;
  const rows = await queryRows(
    `${POST_SELECT} ${clause} ORDER BY p.updated_at DESC LIMIT ${args.pageSize} OFFSET ${offset}`,
    params,
  );
  const items = [];
  for (const row of rows) items.push(mapPost(row, await tagsFor(null, String(row.id))));
  return { items, total: Number(count?.count ?? 0), page: args.page, pageSize: args.pageSize };
}

export async function slugAvailability(slug: string, excludeId?: string | null): Promise<{ available: boolean; suggestion: string }> {
  const base = suggestSlug(slug);
  let candidate = base;
  for (let n = 2; n < 50; n += 1) {
    const post = await queryOne<{ id: string }>(
      'SELECT id FROM blog_posts WHERE slug = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)',
      [candidate, excludeId || null],
    );
    const redirect = await queryOne<{ post_id: string }>(
      'SELECT post_id FROM blog_slug_redirects WHERE slug = $1',
      [candidate],
    );
    const takenByOther = !!post || (!!redirect && redirect.post_id !== excludeId);
    if (!takenByOther) return { available: candidate === base, suggestion: candidate };
    candidate = `${base.slice(0, 70)}-${n}`.replace(/-+/g, '-');
  }
  return { available: false, suggestion: `${base}-post` };
}

export async function listCategories(): Promise<BlogCategory[]> {
  return queryRows<BlogCategory>(
    `SELECT c.id, c.name, c.slug,
            COUNT(p.id) FILTER (WHERE p.status = 'published')::int AS post_count
     FROM blog_categories c
     LEFT JOIN blog_posts p ON p.category_id = c.id
     GROUP BY c.id
     ORDER BY c.name`,
  );
}

export async function listPublicCategories(): Promise<BlogCategory[]> {
  return queryRows<BlogCategory>(
    `SELECT c.id, c.name, c.slug, COUNT(p.id)::int AS post_count
     FROM blog_categories c
     JOIN blog_posts p ON p.category_id = c.id AND p.status = 'published'
     GROUP BY c.id
     HAVING COUNT(p.id) > 0
     ORDER BY c.name`,
  );
}

const CARD_FROM = `
  FROM blog_posts p
  LEFT JOIN blog_categories c ON c.id = p.category_id
  LEFT JOIN blog_media fm ON fm.id = p.featured_media_id
`;

function mapCard(row: Record<string, unknown>): BlogCard {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    excerpt: String(row.excerpt ?? ''),
    author_name: String(row.author_name ?? ''),
    published_at: iso(row.published_at as Date | string | null),
    category_name: row.category_name ? String(row.category_name) : null,
    category_slug: row.category_slug ? String(row.category_slug) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    image_alt: row.image_alt ? String(row.image_alt) : null,
  };
}

export async function listPublishedCards(args: {
  page: number;
  pageSize: number;
  categorySlug?: string | null;
  tagSlug?: string | null;
  q?: string | null;
}) {
  const where: string[] = [];
  const params: unknown[] = [];
  let join = '';
  if (args.categorySlug) {
    params.push(args.categorySlug);
    where.push(`c.slug = $${params.length}`);
  }
  if (args.tagSlug) {
    params.push(args.tagSlug);
    join = `JOIN blog_post_tags pt ON pt.post_id = p.id JOIN blog_tags tg ON tg.id = pt.tag_id AND tg.slug = $${params.length}`;
  }
  if (args.q) {
    params.push(likeTerm(args.q));
    where.push(`(p.title ILIKE $${params.length} ESCAPE '\\' OR p.excerpt ILIKE $${params.length} ESCAPE '\\')`);
  }
  const clause = where.length ? `AND ${where.join(' AND ')}` : '';
  const count = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count ${CARD_FROM} ${join}
     WHERE p.status = 'published' ${clause}`,
    params,
  );
  const offset = (args.page - 1) * args.pageSize;
  const rows = await queryRows(
    `SELECT p.id, p.title, p.slug, p.excerpt, p.author_name, p.published_at,
            c.name AS category_name, c.slug AS category_slug,
            fm.url AS image_url, fm.alt_text AS image_alt
     ${CARD_FROM} ${join}
     WHERE p.status = 'published' ${clause}
     ORDER BY p.published_at DESC NULLS LAST
     LIMIT ${args.pageSize} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map(mapCard), total: Number(count?.count ?? 0), page: args.page, pageSize: args.pageSize };
}

export async function getPublishedBySlug(slug: string): Promise<AdminBlogPost | null> {
  const result = await query(`${POST_SELECT} WHERE p.status = 'published' AND p.slug = $1`, [slug]);
  const row = result.rows[0];
  if (!row) return null;
  return mapPost(row, await tagsFor(null, String(row.id)));
}

export async function resolvePublicSlug(slug: string): Promise<
  | { type: 'post'; post: AdminBlogPost }
  | { type: 'redirect'; slug: string }
  | null
> {
  const post = await getPublishedBySlug(slug);
  if (post) return { type: 'post', post };
  const redirect = await queryOne<{ slug: string }>(
    `SELECT p.slug
     FROM blog_slug_redirects r
     JOIN blog_posts p ON p.id = r.post_id
     WHERE r.slug = $1 AND p.status = 'published'`,
    [slug],
  );
  if (!redirect || redirect.slug === slug) return null;
  return { type: 'redirect', slug: redirect.slug };
}

export async function getCategoryBySlug(slug: string): Promise<BlogCategory | null> {
  return queryOne<BlogCategory>('SELECT id, name, slug FROM blog_categories WHERE slug = $1', [slug]);
}

export async function listSitemapPosts(): Promise<{ slug: string; updated_at: string }[]> {
  const rows = await queryRows<{ slug: string; updated_at: Date }>(
    `SELECT slug, updated_at FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC`,
  );
  return rows.map((row) => ({ slug: row.slug, updated_at: iso(row.updated_at) || new Date().toISOString() }));
}

export async function listBlogMedia(limit = 80): Promise<BlogMedia[]> {
  return queryRows<BlogMedia>(
    `SELECT ${MEDIA_FIELDS} FROM blog_media ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
}

export async function upsertBlogMedia(args: {
  url: string;
  alt: string;
  width: number;
  height: number;
  bytes: number;
  adminId: string;
}): Promise<BlogMedia> {
  const row = await queryOne<BlogMedia>(
    `INSERT INTO blog_media (url, alt_text, width, height, bytes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (url) DO UPDATE SET alt_text = EXCLUDED.alt_text
     RETURNING ${MEDIA_FIELDS}`,
    [args.url, args.alt, args.width, args.height, args.bytes, args.adminId],
  );
  if (!row) throw new BlogInputError('Image could not be saved', 500);
  return row;
}

export async function updateMediaAlt(id: string, alt: string): Promise<BlogMedia | null> {
  return queryOne<BlogMedia>(
    `UPDATE blog_media SET alt_text = $2 WHERE id = $1 RETURNING ${MEDIA_FIELDS}`,
    [id, alt.slice(0, 300)],
  );
}
