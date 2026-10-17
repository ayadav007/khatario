// Highlights: a circle or rectangle (and an optional zoom) that shows up when
// the voice says a phrase. Pure functions so they can be tested without a render.

const SHAPES = ['circle', 'rect', 'none'];
export const FRAME_W = 1920;
export const FRAME_H = 1080;
const ZOOM_IN = 0.6;
const ZOOM_OUT = 0.5;
const ZOOM_LEAD = 0.45;
const MARK_LEAD = 0.15;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const num = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Number(value) : fallback);

export function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
}

/** Highlights for a scene, upgrading the old single zoom fields. */
export function normalizeHighlights(scene) {
  const raw = Array.isArray(scene.highlights)
    ? scene.highlights
    : scene.zoomOn === true
      ? [{
          phrase: '',
          at: scene.zoomAt,
          x: scene.zoomX,
          y: scene.zoomY,
          w: scene.markW,
          h: scene.markH,
          shape: scene.shape,
          zoom: num(scene.zoomScale, 2),
          hold: scene.zoomHold,
        }]
      : [];
  return raw.slice(0, 8).map((item) => {
    const shape = SHAPES.includes(item.shape) ? item.shape : 'circle';
    const zoom = num(item.zoom, 1);
    return {
      phrase: String(item.phrase || '').slice(0, 80),
      at: clamp(num(item.at, 0), 0, 3600),
      x: clamp(num(item.x, 50), 0, 100),
      y: clamp(num(item.y, 50), 0, 100),
      w: clamp(num(item.w, shape === 'rect' ? 28 : 14), 3, 90),
      h: clamp(num(item.h, 16), 3, 90),
      shape,
      zoom: zoom > 1.05 ? clamp(zoom, 1.2, 3) : 1,
      hold: clamp(num(item.hold, 2), 0.5, 30),
    };
  });
}

/** Speech intervals from ffmpeg silencedetect output. */
export function speechSegments(report, duration) {
  const segments = [];
  let cursor = 0;
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  let match;
  while ((match = re.exec(String(report || '')))) {
    const at = Math.max(0, Number(match[2]));
    if (match[1] === 'start') {
      if (at - cursor > 0.06) segments.push({ start: cursor, end: at });
      cursor = Infinity;
    } else {
      cursor = at;
    }
  }
  if (Number.isFinite(cursor) && duration - cursor > 0.06) segments.push({ start: cursor, end: duration });
  return segments;
}

function wordWeight(word) {
  const letters = word.replace(/[^\p{L}\p{N}]/gu, '');
  const digits = letters.replace(/\D/g, '').length;
  return Math.max(1.5, letters.length - digits + digits * 2.5) + 1;
}

function spread(words, start, end, out) {
  const total = words.reduce((sum, word) => sum + wordWeight(word), 0) || 1;
  let at = start;
  for (const word of words) {
    const length = ((end - start) * wordWeight(word)) / total;
    out.push({ text: word, start: at, end: at + length });
    at += length;
  }
}

/**
 * Guess when each word is spoken: the pauses in the clip line up with the
 * punctuation in the text, and words inside a stretch take time by length.
 */
export function estimateWords(text, segments, duration) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const groups = [];
  let group = [];
  for (const word of words) {
    group.push(word);
    if (/[,.;:!?…—]["')\]]*$/.test(word)) {
      groups.push(group);
      group = [];
    }
  }
  if (group.length) groups.push(group);

  let speech = (segments || []).filter((segment) => segment.end > segment.start).map((segment) => ({ ...segment }));
  while (speech.length > groups.length && speech.length > 1) {
    let smallest = 0;
    for (let i = 1; i < speech.length - 1; i += 1) {
      if (speech[i + 1].start - speech[i].end < speech[smallest + 1].start - speech[smallest].end) smallest = i;
    }
    speech.splice(smallest, 2, { start: speech[smallest].start, end: speech[smallest + 1].end });
  }
  const out = [];
  if (speech.length === groups.length) {
    groups.forEach((items, i) => spread(items, speech[i].start, speech[i].end, out));
    return out;
  }
  const start = speech.length ? speech[0].start : 0;
  const end = speech.length ? speech[speech.length - 1].end : duration;
  spread(words, start, Math.max(start + 0.1, end), out);
  return out;
}

/** Start and end of a phrase inside timed words, or null. */
export function findPhrase(words, phrase) {
  const want = tokens(phrase);
  if (!want.length || !words || !words.length) return null;
  const have = words.map((word) => tokens(word.text).join(''));
  for (let i = 0; i + want.length <= have.length; i += 1) {
    if (want.every((token, j) => have[i + j] === token)) {
      return { start: words[i].start, end: words[i + want.length - 1].end };
    }
  }
  for (let i = 0; i < have.length; i += 1) {
    if (have[i] && have[i].startsWith(want[0])) return { start: words[i].start, end: words[i].end };
  }
  return null;
}

/**
 * Absolute times for a scene's highlights.
 * clipStart: when the scene's media starts (video time 0).
 * visible: when the scene is fully on screen; the voice starts here too.
 * until: when the next scene starts covering it.
 */
export function timeHighlights(highlights, { media, clipStart, visible, until, words }) {
  const latest = Math.max(visible, until - ZOOM_OUT - 0.1);
  return highlights
    .map((item) => {
      const hit = words ? findPhrase(words, item.phrase) : null;
      let at = hit
        ? visible + hit.start
        : media === 'video' ? clipStart + item.at : visible + item.at;
      at = clamp(at, visible + 0.05, latest);
      const end = clamp(at + item.hold, at + 0.4, Math.max(at + 0.4, latest));
      return { ...item, start: at, end, pinned: Boolean(hit) };
    })
    .sort((a, b) => a.start - b.start);
}

/** How long a still needs to stay up so manual highlights finish. */
export function stillNeeds(highlights, words) {
  return highlights.reduce((need, item) => {
    if (words && findPhrase(words, item.phrase)) return need;
    return Math.max(need, item.at + item.hold + ZOOM_OUT + 0.3);
  }, 0);
}

function camera(item) {
  const s = item.zoom;
  const x = clamp(FRAME_W / 2 - (item.x / 100) * FRAME_W * s, FRAME_W - FRAME_W * s, 0);
  const y = clamp(FRAME_H / 2 - (item.y / 100) * FRAME_H * s, FRAME_H - FRAME_H * s, 0);
  return { scale: Number(s.toFixed(3)), x: Math.round(x), y: Math.round(y) };
}

const state = (value) => `{ scale: ${value.scale}, x: ${value.x}, y: ${value.y} }`;
const t = (value) => Number(value.toFixed(2));

/** GSAP lines and mark markup for one scene. */
export function highlightTimeline(timed, { frameId, prefix }) {
  const tweens = [`tl.set("#${frameId}", { transformOrigin: "0% 0%", scale: 1, x: 0, y: 0 }, 0);`];
  const marks = [];
  const rest = { scale: 1, x: 0, y: 0 };
  let current = rest;
  let free = 0;
  const zooms = timed.filter((item) => item.zoom > 1);
  zooms.forEach((item, i) => {
    const target = camera(item);
    const inAt = Math.max(free, item.start - ZOOM_LEAD);
    tweens.push(`tl.fromTo("#${frameId}", ${state(current)}, { ...${state(target)}, duration: ${ZOOM_IN}, ease: "power2.inOut", immediateRender: false }, ${t(inAt)});`);
    current = target;
    free = inAt + ZOOM_IN;
    const next = zooms[i + 1];
    const outAt = Math.max(free, item.end);
    if (next && next.start - ZOOM_LEAD < outAt + ZOOM_OUT + 0.4) return;
    tweens.push(`tl.fromTo("#${frameId}", ${state(current)}, { ...${state(rest)}, duration: ${ZOOM_OUT}, ease: "power2.inOut", immediateRender: false }, ${t(outAt)});`);
    current = rest;
    free = outAt + ZOOM_OUT;
  });
  timed.forEach((item, i) => {
    if (item.shape === 'none') return;
    const id = `${prefix}-${i + 1}`;
    const size = item.shape === 'rect' ? `width:${item.w}%;height:${item.h}%;` : `width:${item.w}%;`;
    marks.push(`<div id="${id}" class="mark ${item.shape}" style="left:${item.x}%;top:${item.y}%;${size}"></div>`);
    const showAt = Math.max(0, item.start - MARK_LEAD);
    tweens.push(`tl.fromTo("#${id}", { xPercent: -50, yPercent: -50, scale: 0.6, opacity: 0 }, { xPercent: -50, yPercent: -50, scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)", immediateRender: false }, ${t(showAt)});`);
    tweens.push(`tl.fromTo("#${id}", { opacity: 1 }, { opacity: 0, duration: 0.3, ease: "power1.in", immediateRender: false }, ${t(Math.max(showAt + 0.3, item.end))});`);
  });
  return { tweens, marks };
}
