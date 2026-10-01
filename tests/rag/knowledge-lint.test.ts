import { readFileSync } from 'fs';
import { listKnowledgeFiles, loadMarkdownSource } from '@/lib/rag/ingest/markdown-source';
import { parseFrontmatter } from '@/lib/rag/ingest/frontmatter';

const files = listKnowledgeFiles();

describe('knowledge base content', () => {
  it('has knowledge files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [f.replace(/\\/g, '/').split('/knowledge/')[1], f]))('%s is valid', (_name, file) => {
    const source = loadMarkdownSource(file);
    const doc = source.documents[0];
    const raw = readFileSync(file, 'utf8');
    const { data } = parseFrontmatter(raw);

    expect(data.title).toBeTruthy();
    expect(doc.audiences.length).toBeGreaterThan(0);
    expect(doc.audiences).not.toContain('tenant_customer');
    expect(doc.body).toMatch(/^# /m);

    if (doc.audiences.includes('gst_law')) {
      // Statute text: some Rules have no chapters, and amounts in it are legal thresholds, not Khatario prices.
      expect(doc.audiences).toEqual(['gst_law']);
      expect(doc.body).toMatch(/^#{2,3} /m);
      return;
    }
    expect(doc.body).toMatch(/^## /m);
    // Prices and plan limits live only in the generated plans document so they never go stale.
    expect(doc.body).not.toMatch(/₹\s?\d|\bRs\.?\s?\d|\bINR\s?\d|\d+\s?(rupees|\/-)/i);
  });
});
