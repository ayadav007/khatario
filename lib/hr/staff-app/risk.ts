/**
 * Decides whether a Khatario Staff punch is genuine. Pure: every input is what the phone
 * reported plus what the server already knows. Hard failures reject outright; softer signs
 * add points, and the total picks accepted / review / rejected.
 */
import { distanceMeters } from '@/lib/hr/geofence';

export type LocationSample = {
  lat: number;
  lng: number;
  accuracy_m: number;
  altitude_m: number | null;
  /** Phone clock, ms since epoch. */
  timestamp_ms: number;
  is_mocked: boolean;
};

export type WifiSighting = { bssid: string; ssid?: string | null; rssi?: number | null };

export type DeviceSignals = {
  rooted: boolean;
  emulator: boolean;
  developer_options: boolean;
  adb_enabled: boolean;
  /** Short codes from the phone, e.g. "su_binary", "test_keys". Logged, not trusted. */
  hints?: string[];
};

export type RiskSite = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  require_wifi: boolean;
  bssids: string[];
};

export type LastPunch = { lat: number; lng: number; at: Date };

/** What the face check found (face/match.ts). Absent when the employee has no enrolled face. */
export type FaceEvidence = {
  /** Null when the liveness report matched the challenge; else a short code from face/liveness.ts. */
  liveness_problem: string | null;
  /** False when the server could not load the face models. */
  engine_available: boolean;
  photos_sent: number;
  /** Photos with exactly one usable face. */
  photos_with_face: number;
  multiple_faces: boolean;
  /** Median best cosine similarity to the employee's own templates. */
  similarity: number | null;
  /** The photos look like the same person as each other. */
  consistent: boolean;
  /** A head turn was visible in the turned photo; null when there was none to check. */
  pose_seen: boolean | null;
  /** A photo identical to one sent with an earlier punch. */
  replayed: boolean;
};

export type RiskInput = {
  samples: LocationSample[];
  wifi: WifiSighting[];
  signals: DeviceSignals;
  /** Phone clock when it sent the punch. */
  client_time_ms: number;
  server_now: Date;
  sites: RiskSite[];
  last_punch: LastPunch | null;
  face?: FaceEvidence | null;
};

export type RiskReason = { code: string; message: string; points: number; hard?: boolean };

export type RiskDecision = 'accepted' | 'review' | 'rejected';

export type RiskResult = {
  decision: RiskDecision;
  score: number;
  reasons: RiskReason[];
  site: RiskSite | null;
  distance_m: number | null;
  wifi_matched: boolean;
  position: { lat: number; lng: number; accuracy_m: number } | null;
};

export const MIN_SAMPLES = 3;
export const REVIEW_AT = 30;
export const REJECT_AT = 70;
/** Most of a GPS error circle we forgive at the fence edge. */
const MAX_ACCURACY_ALLOWANCE_M = 30;
const WIFI_MATCH_CREDIT = 30;
/** Face similarity needed to pass without review (see face/match.ts). */
export const FACE_MATCH_AT = 0.4;
export const MIN_FACE_PHOTOS = 2;

export function normalizeBssid(raw: string): string | null {
  const hex = raw.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return null;
  if (hex === '000000000000' || hex === '020000000000') return null; // Android's "hidden" BSSID
  return hex.match(/.{2}/g)!.join(':');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function hard(code: string, message: string): RiskReason {
  return { code, message, points: 100, hard: true };
}

/** Failed liveness, no face or a replayed photo reject; a weak or odd match goes to review. */
export function faceReasons(face: FaceEvidence): RiskReason[] {
  const reasons: RiskReason[] = [];
  if (face.liveness_problem) {
    reasons.push(hard('liveness_failed', 'The face check was not completed. Follow the prompts on screen and try again.'));
  }
  if (face.replayed) reasons.push(hard('photo_replay', 'A photo from an earlier check-in was sent again.'));
  if (!face.engine_available) {
    reasons.push({ code: 'face_unchecked', message: 'Your face could not be checked right now.', points: 30 });
    return reasons;
  }
  if (face.photos_with_face < Math.min(MIN_FACE_PHOTOS, Math.max(face.photos_sent, 1))) {
    reasons.push(hard('face_missing', 'Your face was not clearly visible. Try again in better light.'));
    return reasons;
  }
  if (face.multiple_faces) {
    reasons.push({ code: 'multiple_faces', message: 'More than one face was in the picture.', points: 15 });
  }
  if (face.similarity == null || face.similarity < FACE_MATCH_AT) {
    reasons.push({ code: 'face_mismatch', message: 'Your face did not clearly match your saved face.', points: 40 });
  }
  if (!face.consistent) {
    reasons.push({ code: 'face_inconsistent', message: 'The photos did not all show the same person.', points: 40 });
  }
  if (face.pose_seen === false) {
    reasons.push({ code: 'pose_not_seen', message: 'The head turn was not visible in the photo.', points: 15 });
  }
  return reasons;
}

export function evaluatePunchRisk(input: RiskInput): RiskResult {
  const reasons: RiskReason[] = [];
  const samples = input.samples.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lng) && Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180,
  );

  const empty = (extra: RiskReason): RiskResult => ({
    decision: 'rejected',
    score: 100,
    reasons: [...reasons, extra],
    site: null,
    distance_m: null,
    wifi_matched: false,
    position: null,
  });

  if (input.signals.emulator) reasons.push(hard('emulator', 'Check-in from an emulator is not allowed.'));
  if (samples.some((s) => s.is_mocked)) {
    reasons.push(hard('mock_location', 'A fake-location app is active on this phone. Turn it off and try again.'));
  }
  if (input.face) reasons.push(...faceReasons(input.face));
  if (samples.length < MIN_SAMPLES) {
    return empty(hard('no_location', 'Could not get your location. Turn on location (high accuracy) and try again.'));
  }
  if (input.sites.length === 0) {
    return empty(hard('no_site', 'Your employer has not set up an office location for check-in yet.'));
  }

  const lat = median(samples.map((s) => s.lat));
  const lng = median(samples.map((s) => s.lng));
  const accuracy = median(samples.map((s) => s.accuracy_m));

  // Wi-Fi: a sighting of a trusted router is strong proof of being on site.
  const seen = new Set(input.wifi.map((w) => normalizeBssid(w.bssid)).filter((b): b is string => !!b));
  const wifiSite = input.sites.find((s) => s.bssids.some((b) => seen.has(b))) ?? null;

  let nearest: RiskSite | null = null;
  let nearestDistance = Infinity;
  for (const site of input.sites) {
    const d = distanceMeters(lat, lng, site.lat, site.lng);
    if (d < nearestDistance) {
      nearest = site;
      nearestDistance = d;
    }
  }
  const site = wifiSite ?? nearest!;
  const distance = wifiSite ? distanceMeters(lat, lng, wifiSite.lat, wifiSite.lng) : nearestDistance;
  const allowance = Math.min(Math.max(accuracy, 0), MAX_ACCURACY_ALLOWANCE_M);
  const inside = distance <= site.radius_m + allowance;
  const wifiMatched = wifiSite !== null && wifiSite.id === site.id;

  if (!inside) {
    reasons.push(
      hard('outside_site', `You are about ${Math.round(distance)} m from ${site.name}. Check-in works within ${site.radius_m} m.`),
    );
  }
  if (site.require_wifi && !wifiMatched) {
    reasons.push(hard('wifi_required', `Connect to or stand near ${site.name}'s Wi-Fi to check in.`));
  }
  if (!site.require_wifi && site.bssids.length > 0 && !wifiMatched) {
    reasons.push({ code: 'wifi_not_seen', message: "The office Wi-Fi was not seen.", points: 20 });
  }

  // GPS that looks synthetic.
  const accuracies = samples.map((s) => s.accuracy_m);
  const sameAccuracy = accuracies.every((a) => a === accuracies[0]);
  const samePosition = samples.every((s) => s.lat === samples[0].lat && s.lng === samples[0].lng);
  if (samePosition && sameAccuracy) {
    reasons.push({ code: 'frozen_gps', message: 'Every location reading was identical.', points: 25 });
  }
  if (accuracies.every((a) => a > 0 && a <= 3) && sameAccuracy) {
    reasons.push({ code: 'perfect_accuracy', message: 'Location accuracy was unrealistically perfect.', points: 20 });
  }
  if (samples.every((s) => s.altitude_m === 0) && median(accuracies) <= 20) {
    reasons.push({ code: 'zero_altitude', message: 'GPS reported no altitude.', points: 10 });
  }
  if (accuracy > 100) {
    reasons.push({ code: 'weak_gps', message: `Location was rough (±${Math.round(accuracy)} m).`, points: 20 });
  }

  // Timing: readings must be fresh, spread out, and the phone clock roughly right.
  const times = samples.map((s) => s.timestamp_ms);
  const span = Math.max(...times) - Math.min(...times);
  const newest = Math.max(...times);
  if (span < 2000) {
    reasons.push({ code: 'samples_bunched', message: 'Location readings were taken too close together.', points: 15 });
  }
  if (input.client_time_ms - newest > 60_000) {
    reasons.push({ code: 'stale_location', message: 'Location readings were old.', points: 20 });
  }
  if (Math.abs(input.server_now.getTime() - input.client_time_ms) > 10 * 60_000) {
    reasons.push({ code: 'clock_off', message: "The phone's clock is wrong.", points: 15 });
  }

  // Impossible travel since the last accepted punch.
  if (input.last_punch) {
    const meters = distanceMeters(lat, lng, input.last_punch.lat, input.last_punch.lng);
    const hours = Math.max((input.server_now.getTime() - input.last_punch.at.getTime()) / 3_600_000, 1 / 60);
    if (meters > 5000 && meters / 1000 / hours > 250) {
      reasons.push({ code: 'impossible_travel', message: 'Location jumped too far since the last check-in.', points: 40 });
    }
  }

  if (input.signals.rooted) reasons.push({ code: 'rooted', message: 'This phone is rooted.', points: 40 });
  if (input.signals.developer_options) {
    reasons.push({ code: 'developer_options', message: 'Developer options are on.', points: 10 });
  }
  if (input.signals.adb_enabled) reasons.push({ code: 'usb_debugging', message: 'USB debugging is on.', points: 10 });

  const softPoints = reasons.filter((r) => !r.hard).reduce((sum, r) => sum + r.points, 0);
  const isHard = reasons.some((r) => r.hard);
  // A rooted phone can fake Wi-Fi scans too, so the router no longer vouches for it.
  const credit = wifiMatched && !input.signals.rooted ? WIFI_MATCH_CREDIT : 0;
  const score = isHard ? 100 : Math.max(0, softPoints - credit);
  const decision: RiskDecision = isHard || score >= REJECT_AT ? 'rejected' : score >= REVIEW_AT ? 'review' : 'accepted';

  return {
    decision,
    score: Math.min(score, 100),
    reasons,
    site,
    distance_m: Math.round(distance),
    wifi_matched: wifiMatched,
    position: { lat, lng, accuracy_m: accuracy },
  };
}
