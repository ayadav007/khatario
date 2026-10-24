// Generates the 8 scene sub-compositions and the root index.html from one place,
// so every scene shares the same canvas, type, palette (see frame.md) and motion.
// Usage: node tools/build-frames.mjs [16x9|9x16]
//
// Motion (hyperframes-animation rules): headline words arrive as a waterfall-entry,
// illustration pieces arrive on their voiceover cue as a spring-pop-entrance
// (power3.out, no overshoot), the green disc breathes on a finite sine-wave-loop,
// taps use press-release-spring, and the scene's content fades out over its last
// 0.4s so cuts read as a soft dip through the cream background.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const format = process.argv[2] === '9x16' ? '9x16' : '16x9';
const W = format === '9x16' ? 1080 : 1920;
const H = format === '9x16' ? 1920 : 1080;
const vertical = format === '9x16';
// The 9:16 cut is its own sibling project (snapshot and render read a project's index.html).
const root = vertical ? join(projectRoot, '..', 'khatario-supplier-hub-9x16') : projectRoot;

const C = {
  bg: '#F7F4EE', ink: '#063F35', accent: '#F58220', accentText: '#B4470E', soft: '#EEF2F1',
  hair: '#E4DDD0', body: '#3D5C56', card: '#FFFFFF', box: '#C99A5B', box2: '#D9AE70', miss: '#C62828',
};

// Layout zones per format.
const L = vertical
  ? { pillX: 80, pillY: 120, textX: 80, textY: 260, textW: 920, head: 104, sub: 44, artX: 90, artY: 760, artW: 900, artH: 780, discX: 40, discY: 700, disc: 1000 }
  : { pillX: 140, pillY: 96, textX: 140, textY: 300, textW: 660, head: 96, sub: 40, artX: 860, artY: 150, artW: 900, artH: 780, discX: 880, discY: 120, disc: 860 };

const shared = `
#root{position:absolute;inset:0;background:${C.bg};overflow:hidden;font-family:Inter,sans-serif;color:${C.ink}}
.k-stage{position:absolute;inset:0}
.k-dots{position:absolute;inset:0;background-image:radial-gradient(rgba(6,63,53,.10) 2px,transparent 2.5px);background-size:36px 36px}
.k-disc{position:absolute;left:${L.discX}px;top:${L.discY}px;width:${L.disc}px;height:${L.disc}px;border-radius:50%;background:${C.soft};will-change:transform}
.k-pill{position:absolute;left:${L.pillX}px;top:${L.pillY}px;padding:12px 26px;border-radius:999px;background:${C.ink};color:${C.bg};font:700 26px/1.2 Inter,sans-serif}
.k-text{position:absolute;left:${L.textX}px;top:${L.textY}px;width:${L.textW}px}
.k-head{font:900 ${L.head}px/1.04 Montserrat,sans-serif;letter-spacing:-.02em;color:${C.ink}}
.k-head .k-w{display:inline-block;will-change:transform}
.k-head .k-hot{color:${C.accentText}}
.k-sub{margin-top:34px;font:700 ${L.sub}px/1.25 Inter,sans-serif;color:${C.body}}
.k-art{position:absolute;left:${L.artX}px;top:${L.artY}px;width:${L.artW}px;height:${L.artH}px}
.k-art svg{display:block;width:100%;height:100%;overflow:visible}
.k-art text{font-family:Inter,sans-serif}
`;

// SVG helpers (art space is 900 x 780).
const t = (x, y, s, txt, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${s}" font-weight="${o.w || 700}" fill="${o.fill || C.ink}" text-anchor="${o.a || 'start'}"${o.id ? ` id="${o.id}"` : ''}>${txt}</text>`;
const shop = (x, y, color, label) => `
  <path d="M${x} ${y + 110} L${x + 120} ${y} L${x + 240} ${y + 110} Z" fill="${color}"/>
  <rect x="${x + 20}" y="${y + 110}" width="200" height="170" rx="10" fill="${C.card}" stroke="${color}" stroke-width="6"/>
  <rect x="${x + 40}" y="${y + 140}" width="56" height="44" rx="6" fill="${color}"/>
  <rect x="${x + 144}" y="${y + 140}" width="56" height="44" rx="6" fill="${color}"/>
  <rect x="${x + 96}" y="${y + 200}" width="48" height="80" rx="4" fill="${color}"/>
  ${label ? t(x + 120, y + 330, 30, label, { a: 'middle' }) : ''}`;
const phoneFrame = (x, y, w, h) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="40" fill="${C.ink}"/>
  <rect x="${x + 14}" y="${y + 14}" width="${w - 28}" height="${h - 28}" rx="30" fill="${C.card}"/>`;
const button = (x, y, w, label, fill = C.ink, color = C.bg) =>
  `<rect x="${x}" y="${y}" width="${w}" height="64" rx="32" fill="${fill}"/>${t(x + w / 2, y + 42, 28, label, { a: 'middle', fill: color })}`;
const boxes = (x, y, n, s = 70) =>
  Array.from({ length: n }, (_, i) => `<rect x="${x + i * (s + 12)}" y="${y}" width="${s}" height="${s}" rx="8" fill="${i % 2 ? C.box2 : C.box}"/><line x1="${x + i * (s + 12) + s / 2}" y1="${y}" x2="${x + i * (s + 12) + s / 2}" y2="${y + s}" stroke="${C.bg}" stroke-width="4"/>`).join('');
const bar = (x, y, w, h, fill, level, reorder, fillId) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 2}" fill="${C.soft}" stroke="${C.ink}" stroke-width="4"/>
  <rect${fillId ? ` id="${fillId}"` : ''} x="${x + 8}" y="${y + h - 8 - (h - 16) * level}" width="${w - 16}" height="${(h - 16) * level}" rx="14" fill="${fill}"/>
  ${reorder != null ? `<line x1="${x - 24}" y1="${y + h - (h * reorder)}" x2="${x + w + 24}" y2="${y + h - (h * reorder)}" stroke="${C.accent}" stroke-width="5" stroke-dasharray="12 10"/>` : ''}`;
const tick = (cx, cy, r = 34, fill = C.ink) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/><path d="M${cx - r * 0.42} ${cy} L${cx - r * 0.1} ${cy + r * 0.32} L${cx + r * 0.45} ${cy - r * 0.32}" fill="none" stroke="${C.bg}" stroke-width="${r * 0.2}" stroke-linecap="round" stroke-linejoin="round"/>`;
const arrow = (x1, y1, x2, y2, color = C.accent) => {
  const a = Math.atan2(y2 - y1, x2 - x1), h = 22;
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
    <path d="M${x2 - h * Math.cos(a - 0.5)} ${y2 - h * Math.sin(a - 0.5)} L${x2} ${y2} L${x2 - h * Math.cos(a + 0.5)} ${y2 - h * Math.sin(a + 0.5)}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
};
const kurti = (x, y, s, color) => `<path d="M${x + 22 * s} ${y} L${x + 58 * s} ${y} L${x + 70 * s} ${y + 18 * s} L${x + 64 * s} ${y + 24 * s} L${x + 64 * s} ${y + 110 * s} L${x + 16 * s} ${y + 110 * s} L${x + 16 * s} ${y + 24 * s} L${x + 10 * s} ${y + 18 * s} Z" fill="${color}"/><path d="M${x + 30 * s} ${y} Q${x + 40 * s} ${y + 14 * s} ${x + 50 * s} ${y}" fill="none" stroke="${C.card}" stroke-width="${3 * s}"/>`;

// Voiceover clip lengths in seconds (assets/voice/0N.mp3, Swara). Each scene runs
// its line plus air; the voice starts VO_LEAD into the scene.
const VO = [6.624, 9.984, 6.744, 9.912, 10.584, 9.552, 9.024, 10.176];
const VO_LEAD = 0.3;

// Each scene's art is a list of beats: a <g> that arrives at `at` (scene seconds).
// fx: pop (default), up, left, growX (from its left edge), fade. pulse: seconds when
// a held element gets a short attention pulse. press: seconds when a button is tapped.
const scenes = [
  {
    id: 's01-hook', file: '01-hook', dur: 7.5,
    head: 'Stock phir <span class="k-hot">khatam?</span>', sub: 'Aur supplier ka bill abhi bhi haath se?', subAt: 2.3,
    beats: [
      { at: 0.3, fx: 'up', svg: `
        <rect x="60" y="120" width="420" height="560" rx="18" fill="none" stroke="${C.ink}" stroke-width="8"/>
        ${[260, 420, 580].map((y) => `<line x1="60" y1="${y}" x2="480" y2="${y}" stroke="${C.ink}" stroke-width="8"/>`).join('')}
        ${[[0, 1, 1, 1, 1], [1, 0, 0, 1, 0], [1, 1, 0, 1, 1], [0, 1, 1, 0, 1]].map((row, r) => row.map((full, i) => full
          ? `<rect x="${90 + i * 76}" y="${150 + r * 160}" width="56" height="${r === 3 ? 80 : 100}" rx="8" fill="${C.ink}"/>` : '').join('')).join('')}` },
      { at: 1.0, fx: 'fade', pulse: 1.6, svg: `
        ${[[0, 1, 1, 1, 1], [1, 0, 0, 1, 0], [1, 1, 0, 1, 1], [0, 1, 1, 0, 1]].map((row, r) => row.map((full, i) => full ? ''
          : `<rect x="${90 + i * 76}" y="${150 + r * 160}" width="56" height="${r === 3 ? 80 : 100}" rx="8" fill="none" stroke="${C.accent}" stroke-width="5" stroke-dasharray="10 8"/>`).join('')).join('')}` },
      { at: 2.6, fx: 'up', svg: `
        <rect x="560" y="250" width="250" height="330" rx="14" fill="${C.card}" stroke="${C.hair}" stroke-width="5" transform="rotate(-8 685 415)"/>
        <rect x="590" y="220" width="250" height="330" rx="14" fill="${C.card}" stroke="${C.hair}" stroke-width="5"/>
        ${[270, 320, 370, 420, 470].map((y, i) => `<line x1="625" y1="${y}" x2="${i % 2 ? 760 : 805}" y2="${y}" stroke="#C9C2B4" stroke-width="12" stroke-linecap="round"/>`).join('')}` },
      { at: 3.6, pulse: 4.6, svg: `<circle cx="840" cy="220" r="44" fill="${C.accent}"/>${t(840, 236, 48, '!', { a: 'middle', fill: C.ink, w: 900 })}` },
    ],
  },
  {
    id: 's02-old-way', file: '02-old-way', dur: 10.9,
    head: 'Call. Wait. <span class="k-hot">Type.</span>', headTimes: [0.3, 1.5, 2.7],
    sub: 'Aur 12 ka dabba, 1 piece ban jaata hai.', subAt: 6.0,
    beats: [
      { at: 0.4, svg: `
        <rect x="40" y="60" width="220" height="220" rx="28" fill="${C.card}" stroke="${C.ink}" stroke-width="6"/>
        <rect x="110" y="95" width="80" height="150" rx="16" fill="${C.ink}"/><rect x="122" y="112" width="56" height="100" rx="6" fill="${C.card}"/>
        <path d="M200 110 q28 18 0 36 M214 96 q48 32 0 64" fill="none" stroke="${C.accent}" stroke-width="6" stroke-linecap="round"/>
        ${t(150, 330, 30, 'Call', { a: 'middle' })}` },
      { at: 1.5, fx: 'left', svg: arrow(270, 170, 320, 170, C.ink) },
      { at: 1.6, svg: `
        <rect x="340" y="60" width="220" height="220" rx="28" fill="${C.card}" stroke="${C.ink}" stroke-width="6"/>
        <circle cx="450" cy="170" r="70" fill="none" stroke="${C.ink}" stroke-width="8"/><line x1="450" y1="170" x2="450" y2="125" stroke="${C.ink}" stroke-width="8" stroke-linecap="round"/>
        <line id="s02-hand" x1="450" y1="170" x2="485" y2="190" stroke="${C.accent}" stroke-width="8" stroke-linecap="round"/>
        ${t(450, 330, 30, 'Wait', { a: 'middle' })}` },
      { at: 2.7, fx: 'left', svg: arrow(570, 170, 620, 170, C.ink) },
      { at: 2.8, svg: `
        <rect x="640" y="60" width="220" height="220" rx="28" fill="${C.card}" stroke="${C.ink}" stroke-width="6"/>
        <rect x="690" y="100" width="140" height="70" rx="10" fill="${C.soft}" stroke="${C.ink}" stroke-width="5"/>
        ${[0, 1, 2, 3].map((i) => `<rect class="s02-key" x="${695 + i * 34}" y="190" width="26" height="26" rx="5" fill="${C.ink}"/><rect class="s02-key" x="${695 + i * 34}" y="224" width="26" height="26" rx="5" fill="${C.ink}"/>`).join('')}
        ${t(750, 330, 30, 'Type', { a: 'middle' })}` },
      { at: 6.1, svg: `${boxes(110, 450, 1, 170)}${t(195, 560, 56, '12', { a: 'middle', fill: C.card, w: 900 })}${t(195, 680, 30, '1 dabba', { a: 'middle' })}` },
      { at: 7.2, fx: 'growX', svg: arrow(330, 535, 470, 535, C.accent) },
      { at: 7.6, svg: `
        <rect x="510" y="470" width="230" height="130" rx="16" fill="${C.card}" stroke="${C.ink}" stroke-width="6"/>
        ${t(625, 562, 72, '1', { a: 'middle', w: 900 })}${t(625, 680, 30, 'Entry: 1 piece', { a: 'middle' })}` },
      { at: 8.6, svg: `<circle cx="760" cy="470" r="44" fill="${C.miss}"/><path d="M742 452 L778 488 M778 452 L742 488" stroke="${C.card}" stroke-width="9" stroke-linecap="round"/>` },
    ],
    extra: `
      tl.fromTo("#s02-hand", { rotation: 0 }, { rotation: 300, svgOrigin: "450 170", duration: 1.6, ease: "none" }, 1.7);
      gsap.utils.toArray(".s02-key").forEach((el, i) => {
        const at = 3.2 + (i * 7 % 8) * 0.18;
        tl.fromTo(el, { fill: "${C.ink}" }, { fill: "${C.accent}", duration: 0.08, ease: "none" }, at);
        tl.to(el, { fill: "${C.ink}", duration: 0.2, ease: "none" }, at + 0.12);
      });`,
  },
  {
    id: 's03-connect', file: '03-connect', dur: 7.6,
    head: 'Ek baar <span class="k-hot">connect</span> karo', headAt: 4.2,
    sub: 'Supplier Hub mein apna wholesaler dhoondo.', subAt: 0.6,
    beats: [
      { at: 0.4, fx: 'up', svg: shop(40, 200, C.ink, 'Aapki dukaan') },
      { at: 1.3, svg: `
        <rect x="300" y="80" width="300" height="70" rx="35" fill="${C.card}" stroke="${C.hair}" stroke-width="4"/>
        <circle cx="342" cy="115" r="16" fill="none" stroke="${C.ink}" stroke-width="5"/><line x1="354" y1="127" x2="368" y2="141" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>
        ${t(388, 126, 28, 'Wholesaler…', { fill: C.body })}` },
      { at: 2.6, fx: 'up', svg: shop(620, 200, C.accent, 'Wholesaler') },
      { at: 4.4, fx: 'growX', svg: `<line x1="290" y1="400" x2="610" y2="400" stroke="${C.ink}" stroke-width="7" stroke-dasharray="18 14"/>` },
      { at: 5.3, pulse: 6.2, svg: tick(450, 400, 52) },
    ],
  },
  {
    id: 's04-order', file: '04-order', dur: 10.8,
    head: 'Stock low? <span class="k-hot">Order ready.</span>', sub: 'Supplier suggest karta hai. Aap ek tap mein confirm.', subAt: 4.9,
    beats: [
      { at: 0.3, fx: 'fade', svg: `${bar(60, 120, 110, 520, C.ink, 0.18, 0.3, 's04-fill')}${t(115, 700, 28, 'Stock', { a: 'middle' })}${t(196, 482, 24, 'Reorder', { fill: C.accentText })}` },
      { at: 2.7, fx: 'growX', svg: arrow(220, 380, 330, 380, C.accent) },
      { at: 3.0, pulse: 3.8, svg: `<circle cx="390" cy="380" r="56" fill="${C.accent}"/>
        <path d="M368 400 h44 l-6 -10 v-22 a16 16 0 0 0 -32 0 v22 z" fill="${C.card}"/><circle cx="390" cy="408" r="7" fill="${C.card}"/>` },
      { at: 4.8, fx: 'up', svg: `${phoneFrame(500, 40, 360, 700)}${t(530, 130, 28, 'Suggested order', { fill: C.body })}` },
      { at: 5.3, svg: `<rect x="530" y="160" width="300" height="190" rx="18" fill="${C.soft}"/>${boxes(552, 182, 3, 64)}
        ${t(552, 306, 30, 'Good Day 75g')}${t(552, 340, 26, '3 dabbe · 36 packet', { fill: C.body, w: 400 })}` },
      { at: 6.3, press: 8.0, svg: button(530, 400, 300, 'Confirm') },
      { at: 8.4, svg: `${tick(800, 560, 30)}${t(530, 572, 26, 'Ek tap. Ho gaya.', { fill: C.body })}` },
    ],
    extra: `
      tl.fromTo("#s04-fill", { scaleY: 3.4, svgOrigin: "115 632" }, { scaleY: 1, svgOrigin: "115 632", duration: 2.0, ease: "power2.inOut" }, 0.5);`,
  },
  {
    id: 's05-bill', file: '05-bill', dur: 11.5,
    head: '3 dabbe = <span class="k-hot">36 packet</span>', headAt: 3.9,
    sub: 'Bill seedha aapki purchase. Typing: zero.', subAt: 0.6,
    beats: [
      { at: 0.4, fx: 'up', svg: `
        <rect x="40" y="80" width="260" height="330" rx="14" fill="${C.card}" stroke="${C.hair}" stroke-width="5"/>
        ${t(70, 140, 28, 'Bill BOS-001')}${[180, 225, 270].map((y, i) => `<line x1="70" y1="${y}" x2="${i === 1 ? 220 : 270}" y2="${y}" stroke="#C9C2B4" stroke-width="12" stroke-linecap="round"/>`).join('')}
        ${t(70, 370, 40, '₹720', { w: 900 })}` },
      { at: 1.6, fx: 'growX', svg: arrow(320, 245, 440, 245, C.accent) },
      { at: 2.0, fx: 'up', svg: `${phoneFrame(470, 40, 390, 560)}${t(500, 120, 26, 'Incoming bill', { fill: C.body })}` },
      { at: 4.0, svg: boxes(500, 150, 3, 70) },
      { at: 5.0, fx: 'growX', svg: arrow(500, 270, 560, 270, C.accent) },
      { at: 5.3, svg: `${t(500, 360, 64, '+36', { w: 900, id: 's05-count' })}${t(640, 360, 30, 'packet', { fill: C.body })}` },
      { at: 6.6, svg: button(500, 410, 330, 'Purchase ready') },
      { at: 7.6, fx: 'fade', svg: `${bar(120, 470, 100, 260, C.ink, 0.86, null, 's05-fill')}${t(170, 768, 26, 'Stock', { a: 'middle' })}` },
      { at: 8.6, svg: `${tick(800, 520, 26)}${t(500, 530, 24, 'Stock updated', { fill: C.body })}` },
    ],
    extra: `
      const n = { v: 0 }, out = document.getElementById("s05-count");
      tl.fromTo(n, { v: 0 }, { v: 36, duration: 1.2, ease: "power2.out", onUpdate: () => { out.textContent = "+" + Math.round(n.v); } }, 5.3);
      tl.fromTo("#s05-fill", { scaleY: 0.2, svgOrigin: "170 722" }, { scaleY: 1, svgOrigin: "170 722", duration: 1.4, ease: "power3.out" }, 7.8);`,
  },
  {
    id: 's06-short', file: '06-short', dur: 10.5,
    head: '4 packet <span class="k-hot">kam aaye?</span>', sub: 'Short mark karo. Debit note ready.', subAt: 2.5,
    beats: [
      { at: 0.4, fx: 'up', svg: `
        <rect x="40" y="200" width="380" height="300" rx="16" fill="${C.box}"/>
        <path d="M40 200 L120 120 L340 120 L420 200 Z" fill="${C.box2}"/>
        ${Array.from({ length: 8 }, (_, i) => `<rect x="${70 + (i % 6) * 56}" y="${230 + Math.floor(i / 6) * 120}" width="42" height="100" rx="8" fill="${C.ink}"/>`).join('')}` },
      { at: 1.2, fx: 'fade', pulse: 1.8, svg: `
        ${Array.from({ length: 4 }, (_, k) => { const i = k + 8; return `<rect x="${70 + (i % 6) * 56}" y="${230 + Math.floor(i / 6) * 120}" width="42" height="100" rx="8" fill="none" stroke="${C.card}" stroke-width="5" stroke-dasharray="8 7"/>`; }).join('')}
        ${t(230, 570, 30, '4 kam', { a: 'middle', fill: C.accentText })}` },
      { at: 2.4, fx: 'up', svg: `${phoneFrame(480, 40, 380, 420)}${t(510, 120, 26, 'Receive bill', { fill: C.body })}` },
      { at: 2.9, svg: `${t(510, 180, 30, 'Short')}<rect x="700" y="146" width="130" height="56" rx="14" fill="${C.soft}" stroke="${C.accent}" stroke-width="5"/>${t(765, 186, 32, '4', { a: 'middle', w: 900 })}` },
      { at: 3.4, press: 4.0, svg: button(510, 240, 320, 'Receive') },
      { at: 4.4, fx: 'left', svg: t(510, 360, 24, 'Supplier ko message gaya', { fill: C.body }) },
      { at: 6.6, fx: 'up', svg: `<rect x="520" y="500" width="300" height="230" rx="14" fill="${C.card}" stroke="${C.hair}" stroke-width="5"/>
        ${t(550, 560, 30, 'Debit note')}${t(550, 640, 48, '₹80', { w: 900 })}` },
      { at: 7.6, svg: tick(780, 690, 30) },
    ],
  },
  {
    id: 's07-new-arrivals', file: '07-new-arrivals', dur: 9.9,
    head: 'Naya collection <span class="k-hot">aaya</span>', sub: 'Catalog se seedha set mein order karo.', subAt: 4.6,
    beats: [
      { at: 0.4, fx: 'up', svg: shop(30, 260, C.accent, 'Wholesaler') },
      { at: 1.2, pulse: 2.0, svg: `<rect x="160" y="170" width="150" height="64" rx="32" fill="${C.ink}"/>${t(235, 213, 28, 'New!', { a: 'middle', fill: C.bg })}` },
      { at: 2.2, fx: 'growX', svg: arrow(300, 420, 420, 420, C.accent) },
      { at: 2.5, fx: 'up', svg: `${phoneFrame(450, 30, 410, 720)}${t(480, 110, 26, 'New arrivals', { fill: C.body })}<rect x="480" y="140" width="350" height="240" rx="18" fill="${C.soft}"/>` },
      { at: 3.0, svg: kurti(500, 175, 1.5, C.accent) },
      { at: 3.15, svg: kurti(620, 175, 1.5, C.ink) },
      { at: 3.3, svg: kurti(740, 175, 1.1, C.box) },
      { at: 4.8, fx: 'up', svg: `${t(480, 430, 30, 'Kurti · ₹450')}
        ${['S', 'M', 'L', 'XL'].map((s, i) => `<rect x="${480 + i * 84}" y="460" width="70" height="56" rx="12" fill="${C.card}" stroke="${C.ink}" stroke-width="4"/>${t(515 + i * 84, 498, 26, s, { a: 'middle' })}`).join('')}` },
      { at: 6.0, fx: 'fade', svg: t(480, 560, 24, 'Set of 4 · Min 4', { fill: C.body }) },
      { at: 6.6, press: 8.0, svg: button(480, 600, 350, 'Order set', C.accent, C.ink) },
    ],
  },
  {
    id: 's08-close', file: '08-close', dur: 12.5,
    head: 'Na call. Na typing. <span class="k-hot">Na mismatch.</span>', headTimes: [0.3, 0.55, 1.2, 1.45, 2.2, 2.45],
    sub: 'Aaj hi apne suppliers ko connect karo.', subAt: 6.2,
    beats: [
      { at: 0.4, fx: 'up', svg: shop(30, 140, C.ink, '') },
      { at: 0.6, fx: 'up', svg: shop(630, 140, C.accent, '') },
      { at: 1.4, fx: 'growX', svg: `<line x1="280" y1="340" x2="620" y2="340" stroke="${C.ink}" stroke-width="7"/>` },
      { at: 2.2, svg: tick(450, 340, 46) },
      { at: 3.8, fx: 'up', pulse: 7.4, svg: `
        <rect x="150" y="530" width="600" height="150" rx="28" fill="${C.ink}"/>
        <rect x="185" y="560" width="90" height="90" rx="20" fill="${C.accent}"/>${t(230, 625, 60, 'K', { a: 'middle', fill: C.ink, w: 900 })}
        ${t(300, 605, 52, 'Khatario', { fill: C.bg, w: 900 })}${t(300, 650, 30, 'Supplier Hub', { fill: '#BFD3CE' })}` },
    ],
  },
];

// Scene starts follow each other.
let clock = 0;
for (const s of scenes) { s.start = +clock.toFixed(2); clock += s.dur; }
const total = +clock.toFixed(2);

// Split a headline into words, keeping the accent span on its words.
const headWords = (head) => {
  const out = [];
  for (const m of head.matchAll(/<span class="k-hot">(.*?)<\/span>|([^\s<]+)/g)) {
    if (m[1]) for (const w of m[1].split(' ')) out.push(`<span class="k-w k-hot">${w}</span>`);
    else out.push(`<span class="k-w">${m[2]}</span>`);
  }
  return out;
};

const FROM = {
  pop: '{ scale: 0.4, opacity: 0, y: 24, transformOrigin: "50% 50%" }',
  up: '{ opacity: 0, y: 48 }',
  left: '{ opacity: 0, x: -40 }',
  growX: '{ opacity: 0, scaleX: 0, transformOrigin: "0% 50%" }',
  fade: '{ opacity: 0 }',
};
const TO = {
  pop: '{ scale: 1, opacity: 1, y: 0, transformOrigin: "50% 50%", duration: 0.6, ease: "power3.out" }',
  up: '{ opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }',
  left: '{ opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }',
  growX: '{ opacity: 1, scaleX: 1, transformOrigin: "0% 50%", duration: 0.6, ease: "power3.inOut" }',
  fade: '{ opacity: 1, duration: 0.5, ease: "power1.out" }',
};

const sceneMotion = (s) => {
  const p = s.id;
  const lines = [];
  const words = headWords(s.head).length;
  // waterfall-entry: words rise in, each starting before the previous settles.
  for (let i = 0; i < words; i++) {
    const at = s.headTimes ? s.headTimes[i] : (s.headAt ?? 0.2) + i * Math.min(0.09, 0.5 / words);
    lines.push(`tl.fromTo("#${p}-w${i}", { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${at});`);
  }
  lines.push(`tl.fromTo("#${p}-sub", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, ${s.subAt});`);
  // spring-pop-entrance per beat, on its voiceover cue.
  s.beats.forEach((b, i) => {
    const fx = b.fx || 'pop';
    lines.push(`tl.fromTo("#${p}-b${i}", ${FROM[fx]}, ${TO[fx]}, ${b.at});`);
    if (b.pulse != null) {
      lines.push(`tl.fromTo("#${p}-b${i}", { scale: 1 }, { scale: 1.08, transformOrigin: "50% 50%", duration: 0.25, ease: "sine.inOut", yoyo: true, repeat: 3, immediateRender: false }, ${b.pulse});`);
    }
    if (b.press != null) {
      // press-release-spring: linear compression, then a settle back.
      lines.push(`tl.fromTo("#${p}-b${i}", { scale: 1 }, { scale: 0.9, transformOrigin: "50% 50%", duration: 0.12, ease: "none", immediateRender: false }, ${b.press});`);
      lines.push(`tl.to("#${p}-b${i}", { scale: 1, duration: 0.45, ease: "power3.out" }, ${b.press + 0.12});`);
    }
  });
  // sine-wave-loop on the backdrop disc, finite.
  const breaths = Math.max(1, Math.floor(s.dur / 2.4));
  lines.push(`tl.fromTo("#${p}-disc", { scale: 1 }, { scale: 1.035, duration: 1.2, ease: "sine.inOut", yoyo: true, repeat: ${breaths * 2 - 1} }, 0);`);
  // Soft exit: content dips out over the scene's last 0.4s.
  lines.push(`tl.fromTo("#${p}-stage", { opacity: 1 }, { opacity: 0, duration: 0.4, ease: "power1.in", immediateRender: false }, ${+(s.dur - 0.4).toFixed(2)});`);
  return lines.map((l) => `        ${l}`).join('\n') + (s.extra || '');
};

const sceneHtml = (s) => `<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <style>${shared}</style>
      <div id="root" data-composition-id="${s.id}" data-width="${W}" data-height="${H}">
        <div class="k-dots"></div>
        <div class="k-disc" id="${s.id}-disc"></div>
        <div class="k-pill">Khatario Supplier Hub</div>
        <div class="k-stage" id="${s.id}-stage">
          <div class="k-text">
            <div class="k-head">${headWords(s.head).map((w, i) => w.replace('<span ', `<span id="${s.id}-w${i}" `)).join(' ')}</div>
            <div class="k-sub" id="${s.id}-sub">${s.sub}</div>
          </div>
          <div class="k-art">
            <svg viewBox="0 0 900 780" xmlns="http://www.w3.org/2000/svg">${s.beats.map((b, i) => `<g id="${s.id}-b${i}">${b.svg}</g>`).join('')}</svg>
          </div>
        </div>
      </div>
      <script>
        const tl = gsap.timeline({ paused: true });
${sceneMotion(s)}
        window.__timelines["${s.id}"] = tl;
      </script>
    </template>
  </body>
</html>
`;

const dir = join(root, 'compositions', 'frames');
mkdirSync(dir, { recursive: true });
for (const s of scenes) writeFileSync(join(dir, `${s.file}.html`), sceneHtml(s));

const hosts = scenes
  .map((s) => `      <div id="${s.id}-host" data-composition-id="${s.id}" data-composition-src="compositions/frames/${s.file}.html" data-start="${s.start}" data-duration="${s.dur}" data-track-index="1" data-width="${W}" data-height="${H}"></div>`)
  .join('\n');
const voices = scenes
  .map((s, i) => `      <audio id="vo-0${i + 1}" src="assets/voice/0${i + 1}.mp3" data-start="${+(s.start + VO_LEAD).toFixed(2)}" data-duration="${VO[i]}" data-track-index="2" data-volume="1"></audio>`)
  .join('\n');

const index = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${W}, height=${H}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: ${C.bg}; }
      #main { width: 100%; height: 100%; position: relative; }
    </style>
  </head>
  <body>
    <div id="main" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${W}" data-height="${H}">
${hosts}
${voices}
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
writeFileSync(join(root, 'index.html'), index);
console.log(`wrote ${scenes.length} scenes (${format}) to ${root}, ${total}s`);
