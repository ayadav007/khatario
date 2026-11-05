import { withoutHrMentions } from '@/lib/rag/ingest/plans-source';

describe('withoutHrMentions', () => {
  it('drops the sentence naming the bundled HR plan', () => {
    expect(
      withoutHrMentions('Billing on computer and phone with POS, barcodes, reminders and 3 users. HR Lite included.'),
    ).toBe('Billing on computer and phone with POS, barcodes, reminders and 3 users.');
  });

  it('returns an empty string when every sentence is about HR', () => {
    expect(withoutHrMentions('Every Business feature, with HR Pro, free during your trial.')).toBe('');
  });

  it('keeps descriptions that do not mention HR', () => {
    expect(withoutHrMentions('Free forever in the Khatario phone app: GST bills and GST reports for one user.')).toBe(
      'Free forever in the Khatario phone app: GST bills and GST reports for one user.',
    );
  });

  it('does not match HR inside other words', () => {
    expect(withoutHrMentions('Three branches. Shared inventory.')).toBe('Three branches. Shared inventory.');
  });
});
