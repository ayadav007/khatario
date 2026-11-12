import { splitLegalLinks } from '@/lib/marketing/legal/links';

it('splits internal and mailto links from text', () => {
  expect(splitLegalLinks('See the [refund policy](/refund-policy) or write to [us](mailto:help@khatario.com).')).toEqual([
    'See the ', { label: 'refund policy', href: '/refund-policy' }, ' or write to ', { label: 'us', href: 'mailto:help@khatario.com' }, '.',
  ]);
});
it('leaves unsafe or external links as plain text', () => {
  for (const t of ['[x](javascript:alert(1))', '[x](https://evil.example)', '[x](//evil.example)'])
    expect(splitLegalLinks(t)).toEqual([t]);
  expect(splitLegalLinks('no links')).toEqual(['no links']);
});
