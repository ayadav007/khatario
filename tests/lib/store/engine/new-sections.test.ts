import { videoEmbedUrl } from '@/lib/store/engine/shared';
import { countdownParts } from '@/components/store/engine/sections/countdown-logic';
import { getSectionSchema, sectionsForTemplate } from '@/lib/store/engine/registry';
import { sanitizeThemeData } from '@/lib/store/engine/sanitize';
import { PAGE_STARTERS } from '@/lib/store/engine/presets/templates';

describe('videoEmbedUrl', () => {
  it('maps YouTube and Vimeo urls to privacy-friendly embeds', () => {
    expect(videoEmbedUrl('https://youtu.be/abc123def45')).toBe('https://www.youtube-nocookie.com/embed/abc123def45');
    expect(videoEmbedUrl('https://www.youtube.com/watch?v=abc123def45&t=3')).toBe('https://www.youtube-nocookie.com/embed/abc123def45');
    expect(videoEmbedUrl('https://youtube.com/embed/abc123def45')).toBe('https://www.youtube-nocookie.com/embed/abc123def45');
    expect(videoEmbedUrl('https://www.youtube.com/shorts/abc123def45')).toBe('https://www.youtube-nocookie.com/embed/abc123def45');
    expect(videoEmbedUrl('https://vimeo.com/123')).toBe('https://player.vimeo.com/video/123');
    expect(videoEmbedUrl('https://player.vimeo.com/video/456')).toBe('https://player.vimeo.com/video/456');
  });

  it('returns null for anything else', () => {
    expect(videoEmbedUrl('https://evil.com/x')).toBeNull();
    expect(videoEmbedUrl('http://youtu.be/abc123def45')).toBeNull();
    expect(videoEmbedUrl('https://youtu.be/short')).toBeNull();
    expect(videoEmbedUrl('https://youtu.be/abc123def45"onload=1')).toBeNull();
    expect(videoEmbedUrl('https://vimeo.com/abc')).toBeNull();
    expect(videoEmbedUrl('not a url')).toBeNull();
    expect(videoEmbedUrl('')).toBeNull();
  });
});

describe('countdownParts', () => {
  const end = '2030-01-02T00:00:00.000Z';
  const endMs = Date.parse(end);
  it('splits the time left into days, hours, minutes and seconds', () => {
    expect(countdownParts(end, endMs - 90061 * 1000)).toEqual({ days: 1, hours: 1, minutes: 1, seconds: 1 });
  });
  it('is null once over, and for an invalid date', () => {
    expect(countdownParts(end, endMs + 1000)).toBeNull();
    expect(countdownParts(end, endMs)).toBeNull();
    expect(countdownParts('soon', 0)).toBeNull();
  });
});

const NEW_TYPES = ['collection-list', 'logo-list', 'video', 'faq', 'newsletter', 'countdown', 'spacer'];

describe('new section schemas', () => {
  it('are registered with the templates the brief lists', () => {
    for (const t of NEW_TYPES) expect(getSectionSchema(t)).not.toBeNull();
    for (const t of ['spacer', 'faq', 'video']) {
      expect(getSectionSchema(t)!.templates).toEqual(expect.arrayContaining(['home', 'page', 'product', 'catalog']));
    }
    for (const t of ['collection-list', 'logo-list', 'newsletter', 'countdown']) {
      expect(getSectionSchema(t)!.templates).toEqual(['home', 'page']);
    }
    expect(sectionsForTemplate('page').map((s) => s.type)).toEqual(expect.arrayContaining(NEW_TYPES));
  });

  it('sanitise a preset round-trip', () => {
    for (const t of NEW_TYPES) {
      const schema = getSectionSchema(t)!;
      const preset = schema.presets[0];
      const blocks: Record<string, { type: string; settings: Record<string, unknown> }> = {};
      const order: string[] = [];
      (preset.blocks ?? []).forEach((b, i) => {
        blocks[`b${i}`] = { type: b.type, settings: b.settings ?? {} };
        order.push(`b${i}`);
      });
      const data = sanitizeThemeData({
        templates: { home: { order: ['s'], sections: { s: { type: t, settings: preset.settings ?? {}, blocks, block_order: order } } } },
      });
      const kept = data.templates.home.sections.s;
      expect(kept?.type).toBe(t);
      expect(kept.block_order).toEqual(order);
    }
  });

  it('drops blocks past the maximum', () => {
    const cases: [string, string, number][] = [
      ['collection-list', 'collection', 12],
      ['logo-list', 'logo', 16],
      ['faq', 'question', 30],
    ];
    for (const [type, blockType, max] of cases) {
      const blocks: Record<string, { type: string; settings: Record<string, unknown> }> = {};
      const order: string[] = [];
      for (let i = 0; i < max + 1; i++) {
        blocks[`b${i}`] = { type: blockType, settings: {} };
        order.push(`b${i}`);
      }
      const data = sanitizeThemeData({
        templates: { home: { order: ['s'], sections: { s: { type, settings: {}, blocks, block_order: order } } } },
      });
      expect(data.templates.home.sections.s.block_order).toHaveLength(max);
    }
  });

  it('keeps defaults for the newsletter and the spacer', () => {
    const news = getSectionSchema('newsletter')!.settings;
    expect(news.find((s) => s.id === 'heading')?.default).toBe('Get offers first');
    expect(news.find((s) => s.id === 'button_label')?.default).toBe('Subscribe');
    const spacer = getSectionSchema('spacer')!.settings;
    expect(spacer.find((s) => s.id === 'height')).toMatchObject({ min: 0, max: 160, step: 8, default: 48 });
  });
});

describe('contact page starter', () => {
  it('adds an faq section after the rich text', () => {
    const tpl = PAGE_STARTERS.contact.build();
    expect(tpl.order.map((id) => tpl.sections[id].type)).toEqual(['rich-text', 'faq']);
    expect(tpl.sections[tpl.order[1]].block_order.length).toBeGreaterThanOrEqual(2);
  });
});

describe('video embed sandbox', () => {
  it('uses the same sandbox as custom HTML iframes and puts it on the video iframe', () => {
    const { EMBED_SANDBOX } = require('@/lib/store/engine/shared');
    const { sanitizeCustomHtml } = require('@/lib/store/engine/html');
    const out = sanitizeCustomHtml('<iframe src="https://www.youtube.com/embed/abc123def45"></iframe>');
    expect(out).toContain(`sandbox="${EMBED_SANDBOX}"`);
    // The components are TSX (not transformed here), so check their source carries the shared constant.
    const fs = require('fs');
    for (const f of ['Video', 'EngineVideoCover']) {
      expect(fs.readFileSync(`components/store/engine/sections/${f}.tsx`, 'utf8')).toContain('sandbox={EMBED_SANDBOX}');
    }
  });
});
