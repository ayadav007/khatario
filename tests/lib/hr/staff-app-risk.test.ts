import {
  evaluatePunchRisk,
  normalizeBssid,
  type FaceEvidence,
  type LocationSample,
  type RiskInput,
} from '@/lib/hr/staff-app/risk';

const NOW = new Date('2026-10-15T04:00:00Z');
const OFFICE = { id: 's1', name: 'Main shop', lat: 28.6139, lng: 77.209, radius_m: 150, require_wifi: false, bssids: [] as string[] };

/** Five readings over ~6 s with a little natural wobble, a few metres from the office. */
function realSamples(over: Partial<LocationSample> = {}): LocationSample[] {
  return [0, 1, 2, 3, 4].map((i) => ({
    lat: 28.61392 + i * 0.000004,
    lng: 77.20903 - i * 0.000003,
    accuracy_m: 8 + i,
    altitude_m: 216 + i * 0.3,
    timestamp_ms: NOW.getTime() - 8000 + i * 1500,
    is_mocked: false,
    ...over,
  }));
}

function input(over: Partial<RiskInput> = {}): RiskInput {
  return {
    samples: realSamples(),
    wifi: [],
    signals: { rooted: false, emulator: false, developer_options: false, adb_enabled: false },
    client_time_ms: NOW.getTime(),
    server_now: NOW,
    sites: [OFFICE],
    last_punch: null,
    ...over,
  };
}

const codes = (r: ReturnType<typeof evaluatePunchRisk>) => r.reasons.map((x) => x.code);

it('accepts a normal check-in inside the office', () => {
  const r = evaluatePunchRisk(input());
  expect(r.decision).toBe('accepted');
  expect(r.score).toBe(0);
  expect(r.site?.id).toBe('s1');
  expect(r.distance_m).toBeLessThan(20);
});

it('rejects when any reading comes from a fake-location app', () => {
  const samples = realSamples();
  samples[2] = { ...samples[2], is_mocked: true };
  const r = evaluatePunchRisk(input({ samples }));
  expect(r.decision).toBe('rejected');
  expect(codes(r)).toContain('mock_location');
});

it('rejects an emulator', () => {
  const r = evaluatePunchRisk(input({ signals: { rooted: false, emulator: true, developer_options: true, adb_enabled: true } }));
  expect(r.decision).toBe('rejected');
  expect(codes(r)).toContain('emulator');
});

it('rejects outside every site, naming the distance', () => {
  const r = evaluatePunchRisk(input({ samples: realSamples({ lat: 28.63, lng: 77.22 }) }));
  expect(r.decision).toBe('rejected');
  expect(codes(r)).toContain('outside_site');
  expect(r.reasons.find((x) => x.code === 'outside_site')!.message).toMatch(/Main shop/);
});

it('rejects with too few readings and when no site is set up', () => {
  expect(codes(evaluatePunchRisk(input({ samples: realSamples().slice(0, 2) })))).toContain('no_location');
  expect(codes(evaluatePunchRisk(input({ sites: [] })))).toContain('no_site');
});

it('sends frozen, perfect GPS to review', () => {
  const frozen = realSamples().map((s) => ({ ...s, lat: 28.6139, lng: 77.209, accuracy_m: 3 }));
  const r = evaluatePunchRisk(input({ samples: frozen }));
  expect(codes(r)).toEqual(expect.arrayContaining(['frozen_gps', 'perfect_accuracy']));
  expect(r.decision).toBe('review');
});

it('a rooted phone goes to review, and office Wi-Fi does not clear it', () => {
  const site = { ...OFFICE, bssids: ['a4:2b:b0:11:22:33'] };
  const r = evaluatePunchRisk(
    input({
      sites: [site],
      wifi: [{ bssid: 'A4-2B-B0-11-22-33' }],
      signals: { rooted: true, emulator: false, developer_options: false, adb_enabled: false },
    }),
  );
  expect(r.wifi_matched).toBe(true);
  expect(r.decision).toBe('review');
});

it('office Wi-Fi offsets small doubts on a clean phone', () => {
  const site = { ...OFFICE, bssids: ['a4:2b:b0:11:22:33'] };
  const r = evaluatePunchRisk(
    input({
      sites: [site],
      wifi: [{ bssid: 'a4:2b:b0:11:22:33' }],
      signals: { rooted: false, emulator: false, developer_options: true, adb_enabled: true },
      samples: realSamples({ accuracy_m: 120 }),
    }),
  );
  expect(r.score).toBe(10); // 20 weak GPS + 10 + 10 - 30 Wi-Fi
  expect(r.decision).toBe('accepted');
});

it('a site that requires Wi-Fi rejects when the router is not seen', () => {
  const site = { ...OFFICE, require_wifi: true, bssids: ['a4:2b:b0:11:22:33'] };
  const r = evaluatePunchRisk(input({ sites: [site], wifi: [{ bssid: '11:22:33:44:55:66' }] }));
  expect(r.decision).toBe('rejected');
  expect(codes(r)).toContain('wifi_required');
});

it('matches the site whose Wi-Fi is seen, not just the nearest one', () => {
  const far = { ...OFFICE, id: 's2', name: 'Godown', lat: 28.6141, lng: 77.2092, bssids: ['de:ad:be:ef:00:01'] };
  const near = { ...OFFICE, lat: 28.61392, lng: 77.20903 };
  const r = evaluatePunchRisk(input({ sites: [near, far], wifi: [{ bssid: 'de:ad:be:ef:00:01' }] }));
  expect(r.site?.id).toBe('s2');
  expect(r.wifi_matched).toBe(true);
});

it('flags impossible travel since the last accepted punch', () => {
  const r = evaluatePunchRisk(
    input({ last_punch: { lat: 19.076, lng: 72.8777, at: new Date(NOW.getTime() - 30 * 60_000) } }), // Mumbai, 30 min ago
  );
  expect(codes(r)).toContain('impossible_travel');
  expect(r.decision).toBe('review');
});

it('flags stale readings and a wrong phone clock', () => {
  const r = evaluatePunchRisk(input({ client_time_ms: NOW.getTime() + 20 * 60_000 }));
  expect(codes(r)).toEqual(expect.arrayContaining(['stale_location', 'clock_off']));
});

it('normalizes router addresses and drops the hidden placeholder', () => {
  expect(normalizeBssid('A4-2B-B0-11-22-33')).toBe('a4:2b:b0:11:22:33');
  expect(normalizeBssid('02:00:00:00:00:00')).toBeNull();
  expect(normalizeBssid('nope')).toBeNull();
});

describe('face check', () => {
  const goodFace: FaceEvidence = {
    liveness_problem: null,
    engine_available: true,
    photos_sent: 3,
    photos_with_face: 3,
    multiple_faces: false,
    similarity: 0.72,
    consistent: true,
    pose_seen: true,
    replayed: false,
  };
  const withFace = (over: Partial<FaceEvidence>) => input({ face: { ...goodFace, ...over } });

  it('a live, matching face is accepted', () => {
    const r = evaluatePunchRisk(input({ face: goodFace }));
    expect(r.decision).toBe('accepted');
    expect(r.score).toBe(0);
  });

  it('failed liveness is a hard reject, even at the office', () => {
    const r = evaluatePunchRisk(withFace({ liveness_problem: 'wrong_steps' }));
    expect(r.decision).toBe('rejected');
    expect(codes(r)).toContain('liveness_failed');
  });

  it('a low similarity goes to review, not reject', () => {
    const r = evaluatePunchRisk(withFace({ similarity: 0.21 }));
    expect(codes(r)).toEqual(['face_mismatch']);
    expect(r.decision).toBe('review');
  });

  it('photos of different people go to review', () => {
    expect(evaluatePunchRisk(withFace({ consistent: false })).decision).toBe('review');
  });

  it('no visible face, or a replayed photo, rejects', () => {
    expect(codes(evaluatePunchRisk(withFace({ photos_with_face: 1 })))).toContain('face_missing');
    expect(evaluatePunchRisk(withFace({ photos_with_face: 1 })).decision).toBe('rejected');
    expect(codes(evaluatePunchRisk(withFace({ photos_sent: 0, photos_with_face: 0 })))).toContain('face_missing');
    expect(evaluatePunchRisk(withFace({ replayed: true })).decision).toBe('rejected');
  });

  it('when the server cannot run the models, the punch goes to review instead of passing', () => {
    const r = evaluatePunchRisk(withFace({ engine_available: false, similarity: null }));
    expect(codes(r)).toEqual(['face_unchecked']);
    expect(r.decision).toBe('review');
  });

  it('a missing head turn alone is a small doubt; with a weak match it stays in review', () => {
    expect(evaluatePunchRisk(withFace({ pose_seen: false })).decision).toBe('accepted');
    const r = evaluatePunchRisk(withFace({ pose_seen: false, similarity: 0.3 }));
    expect(r.score).toBe(55);
    expect(r.decision).toBe('review');
  });

  it('face reasons are reported even when the location also fails', () => {
    const r = evaluatePunchRisk({ ...withFace({ liveness_problem: 'not_passed' }), samples: [] });
    expect(codes(r)).toEqual(expect.arrayContaining(['liveness_failed', 'no_location']));
  });
});
