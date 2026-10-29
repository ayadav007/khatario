import { notificationHref } from '@/lib/notifications/notification-href';
import { PUSH_CHANNEL_ALERTS, type PushJobRow, type PushMessage } from './types';

/** Android shows about this much of a body in the collapsed shade; longer text is expanded on pull. */
export const PUSH_BODY_MAX = 240;
export const PUSH_TITLE_MAX = 80;
/** Brand colour for the small-icon tint. */
export const PUSH_ACCENT_COLOR = '#0F2E24';
/** A business notification older than this is not worth a buzz. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** The in-app page the tap should open (web path). Customer jobs carry their own `href`. */
export function pushHrefFor(job: Pick<PushJobRow, 'kind' | 'data'>): string | null {
  const d = job.data || {};
  if (typeof d.href === 'string' && d.href.startsWith('/')) return d.href;
  if (job.kind !== 'notification') return null;
  return notificationHref({
    type: d.type,
    reference_type: d.reference_type,
    reference_id: d.reference_id,
  });
}

/**
 * Builds the FCM message for a job. A `notification` block lets Android display it in the
 * background and when the app is closed without app code running; the `data` block carries what
 * the app needs to show it in the foreground and to route the tap. Both apps read the same keys.
 */
export function buildPushMessage(job: PushJobRow): PushMessage {
  const href = pushHrefFor(job);
  const data: Record<string, string> = {
    kind: job.kind,
    audience: job.audience,
    business_id: job.business_id,
    job_id: job.id,
    title: clip(job.title, PUSH_TITLE_MAX),
    body: clip(job.body, PUSH_BODY_MAX),
    channel: PUSH_CHANNEL_ALERTS,
  };
  if (job.notification_id) data.notification_id = job.notification_id;
  if (job.notification_seq) data.notification_seq = String(job.notification_seq);
  if (href) data.href = href;
  const type = job.data?.type;
  if (typeof type === 'string') data.type = type;

  // The tag makes a re-fired reminder replace the earlier card instead of stacking a second one.
  const tag = job.notification_id ? `n-${job.notification_id}` : `j-${job.id}`;

  return {
    notification: { title: data.title, body: data.body },
    data,
    android: {
      priority: 'high',
      ttl: PUSH_TTL_SECONDS * 1000,
      collapseKey: tag,
      notification: {
        channelId: PUSH_CHANNEL_ALERTS,
        icon: 'ic_stat_khatario',
        color: PUSH_ACCENT_COLOR,
        sound: 'default',
        tag,
        // Bodies carry customer names and amounts: hidden on a locked screen unless the user allows it.
        visibility: 'private',
        priority: 'high',
        defaultVibrateTimings: true,
      },
    },
  };
}
