import { gstLawSignal, hasLawSources, mergeWithLaw } from '@/lib/rag/gst-law';
import { buildAnswerMessages, formatSources } from '@/lib/rag/prompt';
import type { RetrievedChunk } from '@/lib/rag/types';
import { htmlToLawText } from '../../scripts/kb/fetch-gst-law';

function chunk(id: string, extra: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id,
    documentId: `doc-${id}`,
    title: `Title ${id}`,
    url: null,
    headingPath: `Doc > Heading ${id}`,
    content: `Content ${id}`,
    score: 1,
    vectorRank: null,
    textRank: 1,
    vectorSimilarity: null,
    ...extra,
  };
}

describe('gstLawSignal', () => {
  it.each([
    'What does section 16 of the CGST Act say?',
    'Rule 46 tax invoice',
    'What is the penalty for late filing?',
    'Is it mandatory to register under GST?',
    'GST kanoon mein late fee kitni hai',
    'What is the time limit for a credit note?',
  ])('treats "%s" as an explicit law question', (q) => {
    expect(gstLawSignal(q)).toBe('strong');
  });

  it.each([
    'How do I claim input tax credit?',
    'Reverse charge invoice kaise banaye',
    'How do I make a credit note?',
    'Can Khatario generate an e-way bill?',
  ])('treats "%s" as a GST topic', (q) => {
    expect(gstLawSignal(q)).toBe('topical');
  });

  it.each(['How do I add a customer?', 'Bill kaise banaye', 'Change my invoice logo', 'Kitne ka hai?'])(
    'ignores product questions like "%s"',
    (q) => {
      expect(gstLawSignal(q)).toBe('none');
    },
  );

  it('uses the rewritten query as well as the message', () => {
    expect(gstLawSignal('iska rule kya hai', 'CGST Act section 31 tax invoice')).toBe('strong');
  });
});

describe('mergeWithLaw', () => {
  const guide = [chunk('g1'), chunk('g2'), chunk('g3'), chunk('g4'), chunk('g5'), chunk('g6')];
  const law = [chunk('l1'), chunk('l2'), chunk('l3'), chunk('l4')];

  it('leads with the law for explicit law questions and tags law chunks', () => {
    const merged = mergeWithLaw(guide, law, 'strong', 6);
    expect(merged.map((c) => c.id)).toEqual(['l1', 'l2', 'l3', 'g1', 'g2', 'g3']);
    expect(merged.slice(0, 3).every((c) => c.corpus === 'law')).toBe(true);
    expect(merged.slice(3).some((c) => c.corpus === 'law')).toBe(false);
  });

  it('keeps the product guide first for GST topics', () => {
    expect(mergeWithLaw(guide, law, 'topical', 6).map((c) => c.id)).toEqual(['g1', 'g2', 'g3', 'g4', 'l1', 'l2']);
  });

  it('answers from the law alone when the guides had nothing', () => {
    expect(mergeWithLaw([], law, 'none', 6).map((c) => c.id)).toEqual(['l1', 'l2', 'l3']);
  });

  it('does not mutate the retrieved chunks', () => {
    mergeWithLaw(guide, law, 'strong', 6);
    expect(law[0].corpus).toBeUndefined();
  });
});

describe('law answer prompt', () => {
  it('marks law sources and adds the citation and CA rules only when law is present', () => {
    const lawChunk = { ...chunk('l1', { title: 'Central Goods and Services Tax Act, 2017' }), corpus: 'law' as const };
    expect(formatSources([lawChunk])).toContain('[1] [GST law] Central Goods and Services Tax Act, 2017');
    expect(hasLawSources([lawChunk])).toBe(true);

    const withLaw = buildAnswerMessages({ audience: 'tenant_user', chunks: [chunk('g1'), lawChunk], history: [], message: 'q', language: 'en' });
    expect(withLaw[0].content).toMatch(/CGST Act, Section 31/);
    expect(withLaw[0].content).toMatch(/check with their CA/);

    const guideOnly = buildAnswerMessages({ audience: 'tenant_user', chunks: [chunk('g1')], history: [], message: 'q', language: 'en' });
    expect(guideOnly[0].content).not.toMatch(/\[GST law\]/);
  });
});

describe('htmlToLawText', () => {
  it('keeps the provision text and drops footnote markers and amendment history', () => {
    const html = `<html><head><title>x</title></head><body>
      <p>Section 31. Tax invoice.-</p>
      <p>(1) A registered person supplying taxable goods shall<sup>1</sup> issue a tax invoice&nbsp;showing the 2<sup>nd</sup> copy.</p>
      <p>1. Substituted by the Finance Act, 2020 w.e.f. 1.1.2021.</p>
      <p>Enforced vide notification No. 9/2017.</p>
    </body></html>`;
    const text = htmlToLawText(html);
    expect(text).toContain('(1) A registered person supplying taxable goods shall issue a tax invoice showing the 2nd copy.');
    expect(text).not.toMatch(/Substituted|Enforced|title/);
  });

  it('flattens table cells into readable rows', () => {
    const text = htmlToLawText('<table><tr><td>1.</td><td>Delhi</td></tr></table>');
    expect(text).toBe('1. | Delhi');
  });
});
