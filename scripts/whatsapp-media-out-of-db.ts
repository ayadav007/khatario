/**
 * Moves old WhatsApp media out of the database.
 *
 * Inbox messages used to keep photos, videos and files as base64 `data:` URLs in
 * whatsapp_conversation_messages.media_url. New messages store a short link instead
 * (lib/whatsapp/media-ref.ts). This clears the old rows:
 *   - one-to-one chats: the file is written to storage/whatsapp-media (or WHATSAPP_MEDIA_DIR)
 *     and media_url points at it, so customers' photos stay visible;
 *   - group chats: media_url is cleared (the chat shows "open on the phone"), unless --keep-groups.
 * Postgres only hands the space back to the disk after VACUUM FULL (--vacuum, locks the table briefly).
 *
 * Dry run by default; nothing changes without --apply. Run from the app folder so files land in its storage:
 *   set -a; . ./.env.production; set +a
 *   npx tsx scripts/whatsapp-media-out-of-db.ts                 # report only
 *   npx tsx scripts/whatsapp-media-out-of-db.ts --apply         # move and clear
 *   npx tsx scripts/whatsapp-media-out-of-db.ts --apply --vacuum
 * Options: --keep-groups (write group media to files too), --business=<uuid> (one business only).
 */
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const VACUUM = args.has('--vacuum');
const KEEP_GROUPS = args.has('--keep-groups');
const BUSINESS = process.argv.find((a) => a.startsWith('--business='))?.split('=')[1] || null;
const BATCH = 100;

async function main() {
  const { query, queryRows, closePool } = await import('../lib/db');
  const { parseDataUrl, saveInboxMedia } = await import('../lib/whatsapp/inbox-media');

  if (BUSINESS && !/^[0-9a-f-]{36}$/i.test(BUSINESS)) throw new Error('--business must be a uuid');

  const summary = await queryRows<{ is_group: boolean; rows: string; bytes: string }>(
    `SELECT COALESCE(c.is_group, false) AS is_group, count(*)::text AS rows,
            COALESCE(sum(octet_length(m.media_url)), 0)::text AS bytes
       FROM whatsapp_conversation_messages m
       LEFT JOIN whatsapp_conversations c ON c.id = m.conversation_id
      WHERE m.media_url LIKE 'data:%' AND ($1::uuid IS NULL OR m.business_id = $1::uuid)
      GROUP BY 1`,
    [BUSINESS],
  );
  const mb = (b: string | number) => `${(Number(b) / 1024 / 1024).toFixed(0)} MB`;
  for (const s of summary) {
    console.log(`${s.is_group ? 'group chats' : 'one-to-one '}: ${s.rows} messages, ${mb(s.bytes)} of base64 media`);
  }
  if (!summary.length) console.log('No base64 media left in whatsapp_conversation_messages.');
  if (!APPLY) {
    console.log(`\nDry run. Add --apply to ${KEEP_GROUPS ? 'write all of it to files' : 'write one-to-one media to files and clear group media'}.`);
    await closePool();
    return;
  }

  let lastId = '00000000-0000-0000-0000-000000000000';
  let moved = 0;
  let cleared = 0;
  let unreadable = 0;
  let movedBytes = 0;
  for (;;) {
    const rows = await queryRows<{ id: string; business_id: string; media_url: string; is_group: boolean }>(
      `SELECT m.id, m.business_id, m.media_url, COALESCE(c.is_group, false) AS is_group
         FROM whatsapp_conversation_messages m
         LEFT JOIN whatsapp_conversations c ON c.id = m.conversation_id
        WHERE m.media_url LIKE 'data:%' AND m.id > $1 AND ($2::uuid IS NULL OR m.business_id = $2::uuid)
        ORDER BY m.id
        LIMIT ${BATCH}`,
      [lastId, BUSINESS],
    );
    if (!rows.length) break;
    for (const row of rows) {
      lastId = row.id;
      if (row.is_group && !KEEP_GROUPS) {
        await query(`UPDATE whatsapp_conversation_messages SET media_url = NULL WHERE id = $1`, [row.id]);
        cleared++;
        continue;
      }
      const parsed = parseDataUrl(row.media_url);
      if (!parsed || !parsed.buffer.length) {
        await query(`UPDATE whatsapp_conversation_messages SET media_url = NULL WHERE id = $1`, [row.id]);
        unreadable++;
        continue;
      }
      const mime = parsed.mimeType.split(';')[0].trim();
      const url = await saveInboxMedia(row.business_id, parsed.buffer, mime);
      await query(`UPDATE whatsapp_conversation_messages SET media_url = $1 WHERE id = $2`, [url, row.id]);
      moved++;
      movedBytes += parsed.buffer.length;
    }
    console.log(`… ${moved} written to files (${mb(movedBytes)}), ${cleared} group media cleared, ${unreadable} unreadable cleared`);
  }

  if (VACUUM) {
    console.log('VACUUM FULL whatsapp_conversation_messages (the table is locked until it finishes)…');
    await query('VACUUM FULL whatsapp_conversation_messages');
    const size = await queryRows<{ size: string }>(
      `SELECT pg_size_pretty(pg_total_relation_size('whatsapp_conversation_messages')) AS size`,
    );
    console.log(`Table size now ${size[0]?.size}.`);
  } else {
    console.log('Run again with --apply --vacuum (or VACUUM FULL whatsapp_conversation_messages) to give the space back to the disk.');
  }
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
