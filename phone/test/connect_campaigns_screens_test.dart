import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/campaign_report_screen.dart';
import 'package:khatario_phone/screens/chats/campaigns_screen.dart';
import 'package:khatario_phone/screens/chats/send_message_screen.dart';
import 'package:khatario_phone/ui/kit.dart';

import 'support/recorded_session.dart';

Map<String, dynamic> _row({String id = 'k1', String name = 'Diwali offer', String status = 'running', int total = 10, int sent = 4, int failed = 1, int pending = 5, String type = 'text'}) => {
      'id': id,
      'name': name,
      'message_type': type,
      'message_text': 'Happy Diwali! Come and see our new stock.',
      'status': status,
      'total_recipients': total,
      'sent_count': sent,
      'failed_count': failed,
      'pending_count': pending,
      'created_at': '2026-11-01T05:30:00.000Z',
    };

Finder _icon(String label) => find.byWidgetPredicate((w) => w is KIconButton && w.tooltip == label);

Future<void> _tapText(WidgetTester t, String text, {bool last = false}) async {
  final f = last ? find.text(text).last : find.text(text).first;
  await t.ensureVisible(f);
  await t.tap(f);
  await t.pumpAndSettle();
}

Reply _handler(RequestOptions o, Map b, {List<Map<String, dynamic>>? rows, int? total, String status = 'connected'}) {
  final p = o.uri.path;
  if (p == '/api/whatsapp/status') return (200, {'status': status});
  if (p == '/api/whatsapp/campaigns' && o.method == 'GET') {
    final list = rows ?? [_row()];
    return (200, {'campaigns': list, 'total': total ?? list.length});
  }
  return (200, {'success': true});
}

Map<String, dynamic> _report({String status = 'paused'}) => {
      'campaign': {
        ..._row(status: status, total: 4, sent: 3, failed: 1, pending: 0, type: 'button'),
        'buttons': [
          {'type': 'quick_reply', 'id': 'yes', 'title': 'Yes please'},
          {'type': 'quick_reply', 'id': 'no', 'title': 'No thanks'},
        ],
        'footer': 'Khatario Silks',
        'delay_between_messages': 3,
        'random_delay_jitter': 2,
        'batch_size': 20,
        'pause_between_batches': 120,
        'daily_send_limit': 200,
        'started_at': '2026-11-01T06:00:00.000Z',
        'paused_at': '2026-11-01T07:00:00.000Z',
      },
      'recipients': [
        {'id': 'r1', 'phone': '919876543210', 'name': 'Ravi', 'status': 'read', 'button_clicked_id': 'yes', 'sent_at': '2026-11-01T06:01:00.000Z'},
        {'id': 'r2', 'phone': '919876543211', 'name': null, 'status': 'delivered', 'button_clicked_id': 'yes'},
        {'id': 'r3', 'phone': '919876543212', 'name': 'Asha', 'status': 'pending'},
        {'id': 'r4', 'phone': '919876543213', 'name': 'Meena', 'status': 'failed', 'error_message': 'Not on WhatsApp'},
      ],
    };

void main() {
  group('campaign list', () {
    testWidgets('shows name, type, status, progress and the three counts; asks nothing of the business id', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      expect(find.text('Diwali offer'), findsOneWidget);
      expect(find.textContaining('Happy Diwali! Come and see'), findsOneWidget);
      expect(find.text('Text'), findsOneWidget);
      expect(find.text('Running'), findsWidgets);
      expect(find.text('50%'), findsOneWidget);
      expect(find.textContaining('4 sent / 1 failed / 5 pending'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/whatsapp/campaigns').single.uri.queryParameters, {'limit': '20', 'offset': '0', 'status': 'all'});
      for (final o in sent) {
        expect(o.uri.query.contains('business_id'), isFalse);
      }
    });

    testWidgets('search and the status chips filter on the server', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      await t.enterText(find.byType(TextField).first, 'diwali');
      await t.pump(const Duration(milliseconds: 400));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'GET', '/api/whatsapp/campaigns').last.uri.queryParameters['search'], 'diwali');
      await _tapText(t, 'Paused');
      final q = requestsOf(sent, 'GET', '/api/whatsapp/campaigns').last.uri.queryParameters;
      expect(q['status'], 'paused');
      expect(q['search'], 'diwali');
    });

    testWidgets('Load more appends the next page', (t) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/campaigns' && o.method == 'GET') {
          final first = o.uri.queryParameters['offset'] == '0';
          return (200, {'campaigns': [first ? _row() : _row(id: 'k2', name: 'Second campaign', status: 'completed')], 'total': 2});
        }
        return _handler(o, b);
      });
      await pumpScreen(t, CampaignsScreen(session: session));
      expect(find.text('Showing 1 of 2'), findsOneWidget);
      await _tapText(t, 'Load more');
      expect(find.text('Second campaign'), findsOneWidget);
      expect(find.text('Diwali offer'), findsOneWidget);
      expect(requestsOf(sent, 'GET', '/api/whatsapp/campaigns').last.uri.queryParameters['offset'], '1');
    });

    testWidgets('each status offers what the website offers, and Delete never while running', (t) async {
      final rows = [
        _row(id: 'a', name: 'Draft one', status: 'draft'),
        _row(id: 'b', name: 'Running one', status: 'running'),
        _row(id: 'c', name: 'Paused one', status: 'paused'),
        _row(id: 'd', name: 'Done one', status: 'completed'),
      ];
      final (session, _) = recordedSession((o, b) => _handler(o, b, rows: rows));
      await pumpScreen(t, CampaignsScreen(session: session));
      expect(find.text('Start'), findsOneWidget);
      expect(find.text('Pause'), findsOneWidget);
      expect(find.text('Resume'), findsOneWidget);
      expect(find.text('Restart'), findsOneWidget);
      expect(find.text('Delete'), findsNWidgets(3));
      expect(find.text('View report'), findsNWidgets(4));
    });

    testWidgets('Start checks WhatsApp, asks naming the campaign and audience, patches once, reloads', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b, rows: [_row(status: 'draft', total: 12, sent: 0, failed: 0, pending: 12)]));
      await pumpScreen(t, CampaignsScreen(session: session));
      final statusBefore = requestCount(sent, 'GET', '/api/whatsapp/status');
      await _tapText(t, 'Start');
      expect(requestCount(sent, 'GET', '/api/whatsapp/status'), statusBefore + 1);
      expect(find.text('Start campaign?'), findsOneWidget);
      expect(find.textContaining('Diwali offer'), findsWidgets);
      expect(find.textContaining('12 people'), findsOneWidget);
      expect(requestCount(sent, 'PATCH', '/api/whatsapp/campaigns/k1'), 0);
      await t.tap(inSheet('Start'));
      await t.tap(inSheet('Start'), warnIfMissed: false);
      await t.pumpAndSettle();
      final patches = requestsOf(sent, 'PATCH', '/api/whatsapp/campaigns/k1').toList();
      expect(patches.length, 1);
      expect(patches.single.data, {'action': 'start'});
      expectNoIdentity(patches.single.data as Map);
      expect(find.text('Campaign started successfully'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns'), 2);
    });

    testWidgets('a disconnected WhatsApp stops Start before asking, with the website words', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b, rows: [_row(status: 'draft')], status: 'disconnected'));
      await pumpScreen(t, CampaignsScreen(session: session));
      await _tapText(t, 'Start');
      expect(find.text('WhatsApp is not connected. Please connect your WhatsApp account via Settings before starting/resuming a campaign.'), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      expect(requestCount(sent, 'PATCH', '/api/whatsapp/campaigns/k1'), 0);
    });

    testWidgets('Pause asks, then patches pause, without a WhatsApp check', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      final statusBefore = requestCount(sent, 'GET', '/api/whatsapp/status');
      await _tapText(t, 'Pause');
      expect(find.text('Pause campaign?'), findsOneWidget);
      await t.tap(inSheet('Pause'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/campaigns/k1').single.data, {'action': 'pause'});
      expect(requestCount(sent, 'GET', '/api/whatsapp/status'), statusBefore);
      expect(find.text('Campaign paused successfully'), findsOneWidget);
    });

    testWidgets('Resume and Restart patch resume and start', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b, rows: [_row(status: 'paused')]));
      await pumpScreen(t, CampaignsScreen(session: session));
      await _tapText(t, 'Resume');
      await t.tap(inSheet('Resume'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/campaigns/k1').last.data, {'action': 'resume'});
      await _tapText(t, 'Restart');
      await t.tap(inSheet('Restart'));
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/campaigns/k1').last.data, {'action': 'start'});
    });

    testWidgets('a refused action shows the server words and the list reloads', (t) async {
      final (session, sent) = recordedSession((o, b) => o.method == 'PATCH' ? (400, {'error': 'Cannot start campaign with status: running'}) : _handler(o, b, rows: [_row(status: 'draft')]));
      await pumpScreen(t, CampaignsScreen(session: session));
      await _tapText(t, 'Start');
      await t.tap(inSheet('Start'));
      await t.pumpAndSettle();
      expect(find.text('Cannot start campaign with status: running'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns'), 2);
    });

    testWidgets('Delete asks naming the campaign, deletes once, reloads', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b, rows: [_row(status: 'completed')]));
      await pumpScreen(t, CampaignsScreen(session: session));
      await _tapText(t, 'Delete');
      expect(find.text('Delete campaign?'), findsOneWidget);
      expect(find.textContaining('Diwali offer'), findsWidgets);
      expect(find.textContaining('cannot be undone'), findsOneWidget);
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/campaigns/k1'), 0);
      await t.tap(inSheet('Delete campaign'));
      await t.tap(inSheet('Delete campaign'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/campaigns/k1'), 1);
      expect(find.text('Campaign deleted successfully'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns'), 2);
    });

    testWidgets('two quick taps on Delete open one question, not two', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b, rows: [_row(status: 'completed')]));
      await pumpScreen(t, CampaignsScreen(session: session));
      await t.ensureVisible(find.text('Delete').first);
      await t.tap(find.text('Delete').first);
      await t.tap(find.text('Delete').first, warnIfMissed: false);
      await t.pumpAndSettle();
      expect(find.byType(BottomSheet), findsOneWidget);
      await t.tap(inSheet('Delete campaign'));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'DELETE', '/api/whatsapp/campaigns/k1'), 1);
    });

    testWidgets('a refused delete says why', (t) async {
      final (session, _) = recordedSession((o, b) => o.method == 'DELETE' ? (400, {'error': 'Cannot delete a running campaign. Please pause it first.'}) : _handler(o, b, rows: [_row(status: 'completed')]));
      await pumpScreen(t, CampaignsScreen(session: session));
      await _tapText(t, 'Delete');
      await t.tap(inSheet('Delete campaign'));
      await t.pumpAndSettle();
      expect(find.text('Cannot delete a running campaign. Please pause it first.'), findsOneWidget);
    });

    testWidgets('View report opens that campaign\'s report', (t) async {
      final (session, _) = recordedSession((o, b) => o.uri.path == '/api/whatsapp/campaigns/k1' ? (200, _report()) : _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      await _tapText(t, 'View report');
      expect(find.byType(CampaignReportScreen), findsOneWidget);
      expect((t.widget(find.byType(CampaignReportScreen)) as CampaignReportScreen).campaignId, 'k1');
    });

    testWidgets('empty, filtered-empty, error with Try again, no plan', (t) async {
      final (empty, _) = recordedSession((o, b) => _handler(o, b, rows: []));
      await pumpScreen(t, CampaignsScreen(session: empty));
      expect(find.text('No campaigns yet. Create your first campaign to get started.'), findsOneWidget);
      expect(find.text('Create campaign'), findsOneWidget);
      await _tapText(t, 'Draft');
      expect(find.text('No campaigns match your filters.'), findsOneWidget);

      var fail = true;
      final (session, sent) = recordedSession((o, b) => fail && o.uri.path == '/api/whatsapp/campaigns' ? (400, {'error': 'Failed to load campaigns'}) : _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      expect(find.text('Failed to load campaigns'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Diwali offer'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, CampaignsScreen(session: locked));
      expect(find.text('Not included in your current plan'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      expect(_icon('New campaign'), findsNothing);
    });

    testWidgets('pull to refresh reloads the list', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      await t.drag(find.text('Diwali offer'), const Offset(0, 1600));
      await t.pump(const Duration(seconds: 1));
      await t.pumpAndSettle();
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns'), 2);
    });

    testWidgets('a running campaign refreshes on its own every five seconds', (t) async {
      final (session, sent) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns'), 1);
      await t.pump(const Duration(seconds: 5));
      await t.pump();
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns'), 2);
    });

    testWidgets('New campaign opens Send message on the campaign tab', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b));
      await pumpScreen(t, CampaignsScreen(session: session));
      await t.tap(_icon('New campaign'));
      await t.pumpAndSettle();
      expect(find.byType(SendMessageScreen), findsOneWidget);
      expect(find.text('Campaign name'), findsOneWidget);
    });

    testWidgets('WhatsApp not connected shows the website warning', (t) async {
      final (session, _) = recordedSession((o, b) => _handler(o, b, status: 'disconnected'));
      await pumpScreen(t, CampaignsScreen(session: session));
      expect(find.text('WhatsApp is not connected'), findsOneWidget);
    });
  });

  group('campaign report', () {
    Future<List<RequestOptions>> open(WidgetTester t, {Map<String, dynamic>? report, RecordedStatus? status}) async {
      final (session, sent) = recordedSession((o, b) {
        if (o.uri.path == '/api/whatsapp/campaigns/k1' && o.method == 'GET') return (200, report ?? _report());
        return _handler(o, b);
      });
      await pumpScreen(t, CampaignReportScreen(session: session, campaignId: 'k1'));
      return sent;
    }

    testWidgets('overview: totals, success rate, preview, settings and timeline', (t) async {
      final sent = await open(t);
      expect(find.text('Diwali offer'), findsOneWidget);
      expect(find.text('Total recipients'), findsOneWidget);
      expect(find.text('75%'), findsOneWidget);
      expect(find.text('Khatario Silks'), findsOneWidget);
      expect(find.text('Yes please'), findsOneWidget);
      expect(find.text('2 mins'), findsOneWidget);
      expect(find.text('200'), findsOneWidget);
      expect(find.text('Created'), findsOneWidget);
      expect(find.text('Paused'), findsWidgets);
      expect(requestsOf(sent, 'GET', '/api/whatsapp/campaigns/k1').single.uri.query, '');
    });

    testWidgets('recipients tab lists each person with status, error and the button they tapped', (t) async {
      await open(t);
      await _tapText(t, 'Recipients');
      expect(find.text('Recipients (4)'), findsOneWidget);
      expect(find.text('Ravi'), findsOneWidget);
      expect(find.text('+91 98765 43211'), findsOneWidget);
      expect(find.text('Read'), findsOneWidget);
      expect(find.text('Failed'), findsWidgets);
      expect(find.textContaining('Not on WhatsApp'), findsOneWidget);
      expect(find.textContaining('Tapped: yes'), findsNWidgets(2));
      expect(find.text('Export CSV on the website'), findsOneWidget);
    });

    testWidgets('analytics tab shows clicks per button and the rate', (t) async {
      await open(t);
      await _tapText(t, 'Analytics');
      expect(find.text('Yes please'), findsOneWidget);
      expect(find.textContaining('2 clicks'), findsOneWidget);
      expect(find.textContaining('50.0%'), findsOneWidget);
      expect(find.textContaining('0 clicks'), findsOneWidget);
    });

    testWidgets('analytics for a campaign with no buttons says so', (t) async {
      final r = _report();
      (r['campaign'] as Map)['buttons'] = null;
      await open(t, report: r);
      await _tapText(t, 'Analytics');
      expect(find.text('No buttons in this campaign'), findsOneWidget);
    });

    testWidgets('a paused campaign offers Resume and Restart; Resume checks, asks and patches once', (t) async {
      final sent = await open(t);
      expect(find.text('Restart'), findsOneWidget);
      await _tapText(t, 'Resume');
      expect(find.text('Resume campaign?'), findsOneWidget);
      await t.tap(inSheet('Resume'));
      await t.tap(inSheet('Resume'), warnIfMissed: false);
      await t.pumpAndSettle();
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/campaigns/k1').length, 1);
      expect(requestsOf(sent, 'PATCH', '/api/whatsapp/campaigns/k1').single.data, {'action': 'resume'});
      expect(requestCount(sent, 'GET', '/api/whatsapp/status'), 1);
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns/k1'), 2);
    });

    testWidgets('not found, error with Try again, and no plan', (t) async {
      final (missing, _) = recordedSession((o, b) => (404, {'error': 'Campaign not found'}));
      await pumpScreen(t, CampaignReportScreen(session: missing, campaignId: 'zz'));
      expect(find.text('Campaign not found'), findsWidgets);

      var fail = true;
      final (session, sent) = recordedSession((o, b) => fail ? (400, {'error': 'Campaign request failed'}) : (200, _report()));
      await pumpScreen(t, CampaignReportScreen(session: session, campaignId: 'k1'));
      expect(find.text('Campaign request failed'), findsOneWidget);
      fail = false;
      await t.tap(find.text('Try again'));
      await t.pumpAndSettle();
      expect(find.text('Diwali offer'), findsOneWidget);
      expect(requestCount(sent, 'GET', '/api/whatsapp/campaigns/k1'), 2);

      final (locked, _) = recordedSession((o, b) => (403, {'error': 'x', 'code': 'FEATURE_NOT_IN_PLAN'}));
      await pumpScreen(t, CampaignReportScreen(session: locked, campaignId: 'k1'));
      expect(find.text('Not included in your current plan'), findsOneWidget);
    });
  });
}

typedef RecordedStatus = String;
