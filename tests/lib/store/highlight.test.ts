import { splitHighlight } from '@/components/store/features/catalog/highlight';

describe('splitHighlight', () => {
  it('splits around a case-insensitive match', () => {
    expect(splitHighlight('Blue Shirt', 'shi')).toEqual([
      { text: 'Blue ', match: false },
      { text: 'Shi', match: true },
      { text: 'rt', match: false },
    ]);
  });
  it('returns the text unchanged when nothing matches or q is blank', () => {
    expect(splitHighlight('Blue Shirt', 'zzz')).toEqual([{ text: 'Blue Shirt', match: false }]);
    expect(splitHighlight('Blue Shirt', '  ')).toEqual([{ text: 'Blue Shirt', match: false }]);
  });
  it('drops empty segments when the match is at an edge', () => {
    expect(splitHighlight('Shirt', 'shirt')).toEqual([{ text: 'Shirt', match: true }]);
  });
});
