import { query, queryOne, queryRows } from '@/lib/db';
import { assertNoBannedClaims } from '@/lib/marketing/claims';
import { writeMarketingCopy } from '@/lib/marketing/copy';
import { readCreative, renderCreative } from '@/lib/marketing/creative';
import { MarketingGraphError, publishFacebookPhoto, publishInstagramPhoto } from '@/lib/marketing/meta-graph';
import { loadMarketingSecrets } from '@/lib/marketing/settings';

export type MarketingPostRow = {
  id: string;
  caption: string;
  headline: string;
  image_path: string;
  scheduled_for: string;
  angle: string | null;
  status: 'draft' | 'approved' | 'posted' | 'failed';
  fb_post_id: string | null;
  ig_media_id: string | null;
  error: string | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  posted_at: string | null;
};

const POST_COLUMNS = `id, caption, headline, image_path, scheduled_for::text AS scheduled_for, angle, status,
  fb_post_id, ig_media_id, error, created_by, approved_by, created_at, posted_at`;

export async function listMarketingPosts(status?: string): Promise<MarketingPostRow[]> {
  if (status && status !== 'all') {
    return queryRows<MarketingPostRow>(
      `SELECT ${POST_COLUMNS} FROM marketing_posts WHERE status = $1 ORDER BY scheduled_for DESC, created_at DESC`,
      [status],
    );
  }
  return queryRows<MarketingPostRow>(
    `SELECT ${POST_COLUMNS} FROM marketing_posts ORDER BY scheduled_for DESC, created_at DESC LIMIT 100`,
  );
}

export async function generateMarketingPost(input: {
  adminId: string;
  scheduledFor: string;
  angle: string;
}): Promise<MarketingPostRow> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)) {
    throw new Error('Pick a date in YYYY-MM-DD format');
  }
  const secrets = await loadMarketingSecrets();
  const copy = await writeMarketingCopy(secrets.brief, input.angle.trim());
  assertNoBannedClaims(`${copy.headline}\n${copy.caption}`, secrets.brief.bannedClaims);
  const creative = await renderCreative(copy.headline);
  const row = await queryOne<MarketingPostRow>(
    `INSERT INTO marketing_posts (caption, headline, image_path, scheduled_for, angle, status, created_by)
     VALUES ($1, $2, $3, $4::date, $5, 'draft', $6)
     RETURNING ${POST_COLUMNS}`,
    [copy.caption, copy.headline, creative.imagePath, input.scheduledFor, input.angle.trim() || null, input.adminId],
  );
  if (!row) throw new Error('Could not save the draft');
  return row;
}

export async function updateMarketingPost(input: {
  id: string;
  adminId: string;
  caption?: string;
  action?: 'approve' | 'revert';
}): Promise<MarketingPostRow> {
  const existing = await queryOne<MarketingPostRow>(`SELECT ${POST_COLUMNS} FROM marketing_posts WHERE id = $1`, [input.id]);
  if (!existing) throw new Error('Post not found');
  if (existing.status === 'posted') throw new Error('A published post cannot be edited');

  if (input.action === 'revert') {
    const row = await queryOne<MarketingPostRow>(
      `UPDATE marketing_posts
       SET status = 'draft', error = NULL, approved_by = NULL, updated_at = NOW()
       WHERE id = $1
       RETURNING ${POST_COLUMNS}`,
      [input.id],
    );
    if (!row) throw new Error('Post not found');
    return row;
  }

  const caption = input.caption?.trim() || existing.caption;
  if (input.action === 'approve') {
    const secrets = await loadMarketingSecrets();
    if (!secrets.accessToken || !secrets.pageId) {
      throw new Error('Add the marketing token and Facebook Page id in Setup before approving');
    }
    assertNoBannedClaims(`${existing.headline}\n${caption}`, secrets.brief.bannedClaims);
    const row = await queryOne<MarketingPostRow>(
      `UPDATE marketing_posts
       SET caption = $2, status = 'approved', error = NULL, approved_by = $3, updated_at = NOW()
       WHERE id = $1 AND status IN ('draft', 'failed')
       RETURNING ${POST_COLUMNS}`,
      [input.id, caption, input.adminId],
    );
    if (!row) throw new Error('Only a draft or a failed post can be approved');
    return row;
  }

  if (existing.status === 'approved') throw new Error('Revert the post before editing the caption');
  const secrets = await loadMarketingSecrets();
  assertNoBannedClaims(`${existing.headline}\n${caption}`, secrets.brief.bannedClaims);
  const row = await queryOne<MarketingPostRow>(
    `UPDATE marketing_posts SET caption = $2, updated_at = NOW() WHERE id = $1 RETURNING ${POST_COLUMNS}`,
    [input.id, caption],
  );
  if (!row) throw new Error('Post not found');
  return row;
}

export function creativePublicUrl(origin: string, imagePath: string): string {
  return `${origin.replace(/\/$/, '')}${imagePath}`;
}

export async function publishDuePosts(origin: string): Promise<{ published: number; failed: number; publishedIds: string[] }> {
  const secrets = await loadMarketingSecrets();
  if (!secrets.accessToken || !secrets.pageId) return { published: 0, failed: 0, publishedIds: [] };

  const due = await queryRows<MarketingPostRow>(
    `SELECT ${POST_COLUMNS}
     FROM marketing_posts
     WHERE status = 'approved'
       AND scheduled_for <= (timezone('Asia/Kolkata', now()))::date
     ORDER BY scheduled_for ASC
     LIMIT 5`,
  );

  let published = 0;
  let failed = 0;
  const publishedIds: string[] = [];
  for (const post of due) {
    try {
      let fbPostId = post.fb_post_id;
      let igMediaId = post.ig_media_id;
      if (!fbPostId) {
        const bytes = await readCreative(post.image_path);
        fbPostId = await publishFacebookPhoto(secrets.accessToken, secrets.pageId, post.caption, bytes);
        await query(`UPDATE marketing_posts SET fb_post_id = $2, updated_at = NOW() WHERE id = $1`, [post.id, fbPostId]);
      }
      if (secrets.instagramUserId && !igMediaId) {
        igMediaId = await publishInstagramPhoto(
          secrets.accessToken,
          secrets.instagramUserId,
          post.caption,
          creativePublicUrl(origin, post.image_path),
        );
      }
      await query(
        `UPDATE marketing_posts
         SET status = 'posted', fb_post_id = $2, ig_media_id = $3, error = NULL, posted_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [post.id, fbPostId, igMediaId],
      );
      published += 1;
      publishedIds.push(post.id);
    } catch (error) {
      const message = error instanceof MarketingGraphError || error instanceof Error ? error.message : 'Publish failed';
      await query(`UPDATE marketing_posts SET status = 'failed', error = $2, updated_at = NOW() WHERE id = $1`, [
        post.id,
        message.slice(0, 500),
      ]);
      failed += 1;
    }
  }
  return { published, failed, publishedIds };
}
