import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/lead_sources_logic.dart';

import 'support/recorded_session.dart';

void main() {
  test('paths', () {
    expect(leadSourcesPath, '/api/whatsapp/lead-sources');
    expect(entryLinksPath, '/api/whatsapp/lead-sources/links');
    expect(entryLinkPath('k1'), '/api/whatsapp/lead-sources/links/k1');
    expect(leadSourcePath('s1'), '/api/whatsapp/lead-sources/s1');
    expect(indiaMartSyncPath, '/api/whatsapp/lead-sources/indiamart/sync');
  });

  group('bodies', () {
    const routing = SourceRouting(stageId: 'st1', assignTo: 'u2', labelIds: ['b1', 'b2']);

    test('routing sends nulls for "first open stage" and "nobody"', () {
      expect(routing.toBody(), {'stage_id': 'st1', 'assign_to': 'u2', 'label_ids': ['b1', 'b2']});
      expect(const SourceRouting().toBody(), {'stage_id': null, 'assign_to': null, 'label_ids': <String>[]});
    });

    test('new numbers switch', () {
      expect(directBody(true), {'kind': 'direct', 'enabled': true});
      expect(directBody(false), {'kind': 'direct', 'enabled': false});
    });

    test('IndiaMART connect and save', () {
      expect(indiaMartBody(key: ' K123 ', routing: routing), {'kind': 'indiamart', 'key': 'K123', 'stage_id': 'st1', 'assign_to': 'u2', 'label_ids': ['b1', 'b2']});
      expect(indiaMartBody(key: '  ', routing: const SourceRouting()).containsKey('key'), isFalse);
    });

    test('webhook', () {
      expect(webhookBody(name: ' JustDial ', routing: const SourceRouting()), {'kind': 'webhook', 'name': 'JustDial', 'stage_id': null, 'assign_to': null, 'label_ids': <String>[]});
      expect(webhookBody(name: '', routing: const SourceRouting()).containsKey('name'), isFalse);
    });

    test('tracked link', () {
      expect(entryLinkBody(name: ' Diwali ', phone: ' 919876543210 ', prefillText: ' Hi ', routing: routing), {
        'name': 'Diwali', 'phone': '919876543210', 'prefill_text': 'Hi', 'stage_id': 'st1', 'assign_to': 'u2', 'label_ids': ['b1', 'b2'],
      });
      expect(archiveBody, {'archived': true});
      expect(enabledBody(false), {'enabled': false});
    });

    test('no body carries an identity', () {
      for (final b in [
        directBody(true),
        indiaMartBody(key: 'k', routing: routing),
        webhookBody(name: 'n', routing: routing),
        entryLinkBody(name: 'n', phone: 'p', prefillText: '', routing: routing),
        archiveBody,
        enabledBody(true),
      ]) {
        expectNoIdentity(b);
      }
    });
  });

  group('readers', () {
    final sources = leadSourcesFrom({
      'direct': {'enabled': false},
      'sources': [
        {
          'id': 's1', 'kind': 'indiamart', 'name': 'IndiaMART', 'enabled': true, 'has_key': true, 'stage_id': 'st1', 'assign_to': 'u2',
          'label_ids': ['b1'], 'last_run_at': '2026-11-10T05:00:00.000Z', 'last_result': {'fetched': 5, 'imported': 3}, 'last_error': null, 'leads': 40,
        },
        {'id': 's2', 'kind': 'webhook', 'name': 'JustDial', 'enabled': true, 'token_hint': 'a1b2', 'leads': 1, 'last_run_at': null, 'last_error': 'bad'},
      ],
    });

    test('direct switch defaults to on', () {
      expect(sources.directEnabled, isFalse);
      expect(leadSourcesFrom({'sources': []}).directEnabled, isTrue);
    });

    test('IndiaMART and webhooks are told apart', () {
      expect(sources.indiaMart!.enabled, isTrue);
      expect(sources.indiaMart!.leads, 40);
      expect(sources.indiaMart!.routing.stageId, 'st1');
      expect(sources.indiaMart!.routing.labelIds, ['b1']);
      expect(sources.indiaMart!.lastChecked, contains('3 new'));
      expect(sources.webhooks.single.name, 'JustDial');
      expect(sources.webhooks.single.tokenHint, 'a1b2');
      expect(sources.webhooks.single.lastError, 'bad');
      expect(leadSourcesFrom({}).indiaMart, isNull);
    });

    test('tracked links with their numbers and URLs', () {
      final page = entryLinksFrom({
        'base_url': 'https://khatario.com',
        'suggested_phone': '919876543210',
        'links': [
          {'id': 'k1', 'code': 'K7Q2MX', 'name': 'Diwali poster', 'phone': '919876543210', 'prefill_text': 'Hi', 'clicks': 10, 'qr_scans': 2, 'widget_clicks': 1, 'chats': 4, 'won': 1, 'archived': false},
        ],
      });
      final l = page.links.single;
      expect(page.suggestedPhone, '919876543210');
      expect(l.url(page.baseUrl), 'https://khatario.com/w/K7Q2MX');
      expect(l.statsText, '10 clicks · 2 QR scans · 1 website taps · 4 chats · 1 won');
      expect(l.websiteSnippet(page.baseUrl), '<script src="https://khatario.com/api/public/wa-widget/K7Q2MX" async></script>');
      expect(entryLinksFrom({}).links, isEmpty);
    });

    test('sync result and one-time webhook URL', () {
      expect(syncDoneText({'run': {'imported': 1}}), 'Checked IndiaMART: 1 new lead');
      expect(syncDoneText({'run': {'imported': 3}}), 'Checked IndiaMART: 3 new leads');
      expect(syncDoneText({}), 'Checked IndiaMART: 0 new leads');
      expect(webhookUrlFrom({'url': 'https://khatario.com/api/webhooks/leads/abc'}), 'https://khatario.com/api/webhooks/leads/abc');
      expect(webhookUrlFrom({}), isNull);
    });
  });
}
