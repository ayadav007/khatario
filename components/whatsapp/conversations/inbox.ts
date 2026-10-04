'use client';

export type InboxState = 'active' | 'requesting' | 'intervened';

/** What the signed-in user may do with the open chat (from the messages API). */
export interface OwnershipView {
  inbox_state: InboxState;
  assigned_to: string | null;
  owner_name: string | null;
  is_group: boolean;
  is_supervisor: boolean;
  can_reply: boolean;
  can_intervene: boolean;
  can_resolve: boolean;
  can_transfer: boolean;
  can_take_over: boolean;
}

export type OwnershipEventType =
  | 'intervened'
  | 'transferred'
  | 'taken_over'
  | 'resolved'
  | 'auto_resolved'
  | 'requested'
  | 'released';

export interface OwnershipEvent {
  id: string;
  type: OwnershipEventType;
  actor_user_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_name: string | null;
  created_at: string;
}

export interface TeamMember {
  id: string;
  name: string;
  online?: boolean;
  can_receive?: boolean;
}

export type OwnershipAction = 'intervene' | 'take_over' | 'resolve' | 'transfer';

export const INBOX_STATE_LABEL: Record<InboxState, string> = {
  active: 'Active',
  requesting: 'Requesting',
  intervened: 'Intervened',
};

/** System line shown inside the chat, e.g. "Asha transferred the chat to Ravi". */
export function describeOwnershipEvent(e: OwnershipEvent, meId?: string | null): string {
  const who = (id: string | null, name: string | null) => (id && id === meId ? 'You' : name || 'A team member');
  const actor = who(e.actor_user_id, e.actor_name);
  const target = e.target_user_id && e.target_user_id === meId ? 'you' : e.target_name || 'a team member';
  switch (e.type) {
    case 'intervened':
      return `${actor} intervened`;
    case 'transferred':
      return e.actor_user_id ? `${actor} transferred the chat to ${target}` : `Chat assigned to ${target}`;
    case 'taken_over':
      return `${actor} took over the chat`;
    case 'resolved':
      return `${actor} resolved the chat`;
    case 'auto_resolved':
      return 'Chat auto-resolved after 24 hours without a customer reply';
    case 'requested':
      return 'Customer is waiting for a person';
    case 'released':
      return 'The agent handling this chat is no longer on the team, so it went back to Requesting';
    default:
      return 'Chat updated';
  }
}

const SOUND_KEY = 'wa_inbox_sound';

export function isInboxSoundOn(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SOUND_KEY) !== 'off';
}

export function setInboxSoundOn(on: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
}

let audioCtx: AudioContext | null = null;

/** Short two-tone chime; no audio file needed. Browsers only allow it after the user has interacted with the page. */
export function playInboxChime(): void {
  if (typeof window === 'undefined' || !isInboxSoundOn()) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.15;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.32);
    });
  } catch {
    /* audio is best-effort */
  }
}

export function requestInboxNotificationPermission(): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined);
}

/** Desktop notification, only when the tab is in the background. */
export function showInboxBrowserNotification(title: string, body: string, onClick?: () => void): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, { body, tag: `wa-inbox-${title}` });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}
