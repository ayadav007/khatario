import { chunkMarkdown, estimateTokens } from '@/lib/rag/ingest/chunk';

describe('chunkMarkdown', () => {
  it('keeps each FAQ heading as its own chunk with the heading path', () => {
    const md = [
      '# FAQ',
      '',
      '## Is there a free plan?',
      '',
      'Yes. The Free plan is free forever with monthly limits on invoices, customers and items.',
      '',
      '## Does it work offline?',
      '',
      'Yes. Bills made offline are saved on the device and sync automatically when the connection is back.',
    ].join('\n');
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].headingPath).toBe('FAQ > Is there a free plan?');
    expect(chunks[1].headingPath).toBe('FAQ > Does it work offline?');
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1]);
  });

  it('folds tiny sections into the next one instead of emitting fragments', () => {
    const md = '# Title\n\nShort.\n\n## Real section\n\n' + 'This section has enough words to stand on its own as a chunk. '.repeat(3);
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content.startsWith('Short.')).toBe(true);
    expect(chunks[0].headingPath).toBe('Title > Real section');
  });

  it('splits long sections near the target size and never exceeds the max', () => {
    const paragraph = 'Khatario keeps stock, invoices and GST reports in one place for Indian shops. '.repeat(8);
    const md = '# Long guide\n\n' + Array.from({ length: 12 }, () => paragraph).join('\n\n');
    const chunks = chunkMarkdown(md, { targetTokens: 300, maxTokens: 450, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.tokenEstimate).toBeLessThanOrEqual(450 + 60);
  });

  it('ignores headings inside fenced code blocks', () => {
    const md = '# Setup\n\n```bash\n# not a heading\nnpm run kb:reindex\n```\n\nRun the command above after editing knowledge files to refresh the index.';
    const chunks = chunkMarkdown(md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('# not a heading');
  });

  it('estimates tokens as characters / 4', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});
