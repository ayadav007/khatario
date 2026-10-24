import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateWords, findPhrase, highlightTimeline, normalizeHighlights, speechSegments, stillNeeds, timeHighlights } from './highlights.mjs';

test('reads speech stretches between silences', () => {
  const report = 'silence_start: 0\nsilence_end: 0.3\nsilence_start: 1.2\nsilence_end: 1.5\nsilence_start: 3.0\n';
  assert.deepEqual(speechSegments(report, 3.2), [{ start: 0.3, end: 1.2 }, { start: 1.5, end: 3.0 }]);
});

test('puts each clause on its own speech stretch', () => {
  const words = estimateWords('Open the menu, then click New invoice.', [{ start: 0.3, end: 1.2 }, { start: 1.5, end: 3.0 }], 3.2);
  const hit = findPhrase(words, 'new invoice');
  assert.ok(hit.start > 1.5 && hit.end <= 3.0001, `got ${hit.start}-${hit.end}`);
  assert.ok(findPhrase(words, 'menu').end <= 1.2001);
});

test('merges extra pauses so clauses still line up', () => {
  const segments = [{ start: 0.2, end: 0.6 }, { start: 0.65, end: 1.2 }, { start: 1.6, end: 3 }];
  const words = estimateWords('Open the menu, then click New invoice.', segments, 3.2);
  assert.ok(findPhrase(words, 'click').start >= 1.6);
});

test('ignores case and punctuation when matching a phrase', () => {
  const words = [{ text: 'Click', start: 0, end: 0.3 }, { text: '"New', start: 0.3, end: 0.6 }, { text: 'invoice".', start: 0.6, end: 1 }];
  assert.deepEqual(findPhrase(words, 'new INVOICE'), { start: 0.3, end: 1 });
  assert.equal(findPhrase(words, 'customer'), null);
});

test('upgrades the old single zoom', () => {
  const [item] = normalizeHighlights({ zoomOn: true, zoomAt: 4, zoomX: 20, zoomY: 30, shape: 'rect', zoomHold: 30 });
  assert.equal(item.at, 4);
  assert.equal(item.shape, 'rect');
  assert.equal(item.zoom, 2);
  assert.equal(normalizeHighlights({}).length, 0);
});

test('a highlight never runs past the scene', () => {
  const highlights = normalizeHighlights({ highlights: [{ phrase: '', at: 1, hold: 30, zoom: 2 }] });
  const [timed] = timeHighlights(highlights, { media: 'video', clipStart: 10, visible: 11, until: 18, words: null });
  assert.equal(timed.start, 11.05);
  assert.ok(timed.end <= 18 - 0.5);
});

test('a pinned phrase starts with the word', () => {
  const highlights = normalizeHighlights({ highlights: [{ phrase: 'New invoice', at: 0 }] });
  const words = [{ text: 'Click', start: 0.2, end: 0.5 }, { text: 'New', start: 0.5, end: 0.8 }, { text: 'invoice', start: 0.8, end: 1.3 }];
  const [timed] = timeHighlights(highlights, { media: 'image', clipStart: 4, visible: 5, until: 12, words });
  assert.equal(timed.start, 5.5);
  assert.equal(timed.pinned, true);
  assert.equal(stillNeeds(highlights, words), 0);
});

test('back-to-back zooms pan instead of zooming out between', () => {
  const timed = [
    { x: 20, y: 20, w: 10, h: 10, shape: 'circle', zoom: 2, start: 2, end: 3.5 },
    { x: 80, y: 70, w: 10, h: 10, shape: 'rect', zoom: 2, start: 4, end: 5 },
  ];
  const { tweens, marks } = highlightTimeline(timed, { frameId: 'f1', prefix: 'm1' });
  const frameTweens = tweens.filter((line) => line.startsWith('tl.fromTo("#f1"'));
  assert.equal(frameTweens.length, 3);
  assert.equal(marks.length, 2);
  assert.ok(!frameTweens.some((line) => /x: NaN/.test(line)));
});
