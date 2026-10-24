import { expandQuery, loadGlossary, parseGlossary } from '@/lib/rag/glossary';
import { detectIntentHeuristic, detectLanguageHeuristic } from '@/lib/rag/rewrite';

const glossary = parseGlossary(
  [
    '# comment',
    'bill: [invoice]',
    'udhaar: [credit, receivables]',
    'bill kaise banaye: [create invoice]',
    'maal: [stock, inventory]',
  ].join('\n'),
);

describe('glossary expansion', () => {
  it('parses entries and skips comments', () => {
    expect(glossary.get('udhaar')).toEqual(['credit', 'receivables']);
    expect(glossary.has('# comment')).toBe(false);
  });

  it('expands single Hinglish tokens with English alternatives', () => {
    const groups = expandQuery('udhaar ka hisaab', glossary);
    const udhaar = groups.find((g) => g.term === 'udhaar');
    expect(udhaar?.alternatives).toEqual(expect.arrayContaining(['udhaar', 'credit', 'receivables']));
  });

  it('matches multi-word phrases before single tokens', () => {
    const groups = expandQuery('bill kaise banaye?', glossary);
    expect(groups[0].term).toBe('bill kaise banaye');
    expect(groups[0].alternatives).toEqual(expect.arrayContaining(['create', 'invoice']));
    expect(groups.some((g) => g.term === 'bill')).toBe(false);
  });

  it('loads the repo glossary', () => {
    const repo = loadGlossary();
    expect(repo.size).toBeGreaterThan(50);
    expect(repo.get('udhaar')).toBeDefined();
  });
});

describe('heuristic intent and language', () => {
  it.each([
    ['I want a demo', 'book_demo'],
    ['demo book karna hai', 'book_demo'],
    ['can I talk to a real person', 'talk_to_human'],
    ['which plan is best for my kirana shop', 'recommend_plan'],
    ['how do I sign up', 'start_trial'],
    ['kitne ka hai', 'pricing'],
    ['hello', 'greeting'],
    ['does it work offline', 'question'],
  ])('%s -> %s', (message, intent) => {
    expect(detectIntentHeuristic(message)).toBe(intent);
  });

  it('detects language', () => {
    expect(detectLanguageHeuristic('stock ka hisaab kaise rakhe')).toBe('hinglish');
    expect(detectLanguageHeuristic('How do I add an item?')).toBe('en');
    expect(detectLanguageHeuristic('बिल कैसे बनाएं')).toBe('hi');
  });
});
