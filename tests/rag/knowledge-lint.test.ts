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
    expect(doc.body).toMatch(/^## /m);

    // Prices and plan limits live only in the generated plans document so they never go stale.
    expect(doc.body).not.toMatch(/₹\s?\d|\bRs\.?\s?\d|\bINR\s?\d|\d+\s?(rupees|\/-)/i);
  });
});
