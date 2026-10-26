import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/pipeline_logic.dart';

void main() {
  test('board columns and cards parse from the website API', () {
    final stages = parseBoard({
      'columns': [
        {
          'id': 's1',
          'name': 'Interested',
          'kind': 'open',
          'count': 2,
          'total_value': 42000.5,
          'cards': [
            {
              'id': 'c1',
              'stage_id': 's1',
              'name': 'Priya Traders',
              'deal_value': 42000,
              'owner_name': 'Asha',
              'source': 'indiamart',
              'next_followup_at': '2026-10-20T04:30:00Z',
            },
          ],
        },
        {'id': 's2', 'name': 'Won', 'kind': 'won', 'count': '0', 'total_value': '0', 'cards': []},
      ],
    });
    expect(stages.map((s) => s.name).toList(), ['Interested', 'Won']);
    expect(stages.first.count, 2);
    expect(stages.last.count, 0);
    final card = stages.first.cards.single;
    expect(card.meta(DateTime(2026, 10, 26)), '₹42,000 · IndiaMART · Asha · Follow-up overdue');
  });

  test('lead source descriptions match the website', () {
    expect(describeSource(null, null), 'Direct');
    expect(describeSource('ctwa_ad', {'headline': 'Diwali sale'}), 'WhatsApp ad · Diwali sale');
    expect(describeSource('ctwa_ad', {'ad_id': '123'}), 'WhatsApp ad · ad 123');
    expect(describeSource('link', {'name': 'Poster'}), 'Link / QR · Poster');
    expect(describeSource('lead_api', {'name': 'JustDial', 'product': ''}), 'Lead webhook · JustDial');
  });

  test('remind-me presets use the phone clock', () {
    final mon9 = DateTime(2026, 10, 26, 9); // a Monday
    expect(remindAt(RemindPreset.hour, mon9), DateTime(2026, 10, 26, 10));
    expect(remindAt(RemindPreset.evening, mon9), DateTime(2026, 10, 26, 18));
    expect(remindAt(RemindPreset.evening, DateTime(2026, 10, 26, 19)), DateTime(2026, 10, 27, 18));
    expect(remindAt(RemindPreset.tomorrow, mon9), DateTime(2026, 10, 27, 10));
    expect(remindAt(RemindPreset.monday, mon9), DateTime(2026, 11, 2, 10));
    expect(remindAt(RemindPreset.monday, DateTime(2026, 10, 28, 9)), DateTime(2026, 11, 2, 10));
  });

  test('deal, follow-ups and the due count', () {
    final deal = Deal.fromJson({'stage_id': 's1', 'deal_value': '2500.50', 'source': 'link', 'source_detail': {'name': 'Bio'}});
    expect(deal.dealValue, 2500.5);
    expect(describeSource(deal.source, deal.sourceDetail), 'Link / QR · Bio');
    final list = parseFollowups({
      'followups': [
        {'id': 'f1', 'due_at': '2026-10-26T10:00:00Z', 'note': 'Send quote', 'assigned_name': 'Asha'},
      ],
      'counts': {'overdue': 1, 'today': 2},
    });
    expect(list.single.note, 'Send quote');
    expect(dueFollowupCount({'counts': {'overdue': 1, 'today': 2}}), 3);
    expect(dueFollowupCount(const {}), 0);
  });
}
