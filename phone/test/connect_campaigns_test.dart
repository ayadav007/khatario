import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/campaigns_logic.dart';

Map<String, dynamic> _row({String id = 'k1', String status = 'running', int total = 10, int sent = 4, int failed = 1, int pending = 5}) => {
      'id': id,
      'name': 'Diwali offer',
      'message_type': 'button',
      'message_text': 'Happy Diwali! Come and see our new stock, we have a lot of sarees on sale this week at the shop.',
      'status': status,
      'total_recipients': total,
      'sent_count': sent,
      'failed_count': failed,
      'pending_count': pending,
      'created_at': '2026-11-01T05:30:00.000Z',
    };

void main() {
  group('campaign list', () {
    test('path: limit, offset and status always, search only when typed', () {
      expect(campaignsListPath(), '/api/whatsapp/campaigns?limit=20&offset=0&status=all');
      expect(campaignsListPath(status: 'paused', search: 'dewali offer', offset: 20), '/api/whatsapp/campaigns?limit=20&offset=20&status=paused&search=dewali+offer');
    });

    test('status filter options are the website ones', () {
      expect(campaignStatusFilters.map((s) => s.$1), ['all', 'draft', 'running', 'paused', 'completed', 'failed']);
      expect(campaignStatusFilters.first.$2, 'All status');
    });

    test('reads rows, the total, progress and the message preview', () {
      final page = campaignsFrom({'campaigns': [_row()], 'total': 41});
      expect(page.total, 41);
      final c = page.rows.single;
      expect(c.type, 'Button');
      expect(c.progress, 50);
      expect(c.countsText, '4 sent / 1 failed / 5 pending');
      expect(c.preview.length, lessThanOrEqualTo(63));
      expect(c.preview.endsWith('...'), isTrue);
      expect(c.statusLabel, 'Running');
    });

    test('progress is zero with no recipients', () {
      expect(campaignsFrom({'campaigns': [_row(total: 0, sent: 0, failed: 0, pending: 0)]}).rows.single.progress, 0);
    });

    test('actions follow the website: delete never while running, restart only when paused', () {
      CampaignRow of(String s) => campaignsFrom({'campaigns': [_row(status: s)]}).rows.single;
      expect(of('draft').canStart, isTrue);
      expect(of('draft').canDelete, isTrue);
      expect(of('running').canPause, isTrue);
      expect(of('running').canDelete, isFalse);
      expect(of('running').canStart, isFalse);
      expect(of('paused').canResume, isTrue);
      expect(of('paused').canRestart, isTrue);
      expect(of('paused').canStart, isFalse);
      expect(of('completed').canDelete, isTrue);
      expect(of('completed').canStart, isFalse);
      expect(of('failed').canPause, isFalse);
    });

    test('paths and bodies for start, pause, resume, delete, status', () {
      expect(campaignPath('k 1'), '/api/whatsapp/campaigns/k%201');
      expect(campaignActionBody(CampaignAction.start), {'action': 'start'});
      expect(campaignActionBody(CampaignAction.pause), {'action': 'pause'});
      expect(campaignActionBody(CampaignAction.resume), {'action': 'resume'});
      expect(whatsappStatusPath, '/api/whatsapp/status');
      expect(whatsappConnected({'status': 'connected'}), isTrue);
      expect(whatsappConnected({'status': 'disconnected'}), isFalse);
      expect(notConnectedMessage('start'), 'WhatsApp is not connected. Please connect your WhatsApp account via Settings before starting/resuming a campaign.');
    });

    test('ask texts name the campaign and its audience', () {
      final c = campaignsFrom({'campaigns': [_row(status: 'draft', total: 12)]}).rows.single;
      expect(campaignAsk(c, CampaignAction.start).title, 'Start campaign?');
      expect(campaignAsk(c, CampaignAction.start).text, contains('Diwali offer'));
      expect(campaignAsk(c, CampaignAction.start).text, contains('12 people'));
      expect(campaignAsk(c, CampaignAction.pause).title, 'Pause campaign?');
      expect(campaignAsk(c, CampaignAction.resume).confirm, 'Resume');
      expect(campaignDeleteAsk(c).text, contains('Diwali offer'));
      expect(campaignDeleteAsk(c).text, contains('cannot be undone'));
      expect(campaignDoneText(CampaignAction.start), 'Campaign started successfully');
      expect(campaignDoneText(CampaignAction.pause), 'Campaign paused successfully');
      expect(campaignDoneText(CampaignAction.resume), 'Campaign resumed successfully');
    });
  });

  group('campaign report', () {
    final body = {
      'campaign': {
        ..._row(status: 'paused', total: 4, sent: 3, failed: 1, pending: 0),
        'buttons': [
          {'type': 'quick_reply', 'id': 'yes', 'title': 'Yes please'},
          {'type': 'quick_reply', 'id': 'no', 'title': 'No thanks'},
          {'type': 'call', 'id': 'call_button', 'title': 'Call us', 'phone': '919800000000'},
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
        {'id': 'r3', 'phone': '919876543212', 'name': 'Asha', 'status': 'pending', 'button_clicked_id': null},
        {'id': 'r4', 'phone': '919876543213', 'name': 'Meena', 'status': 'failed', 'error_message': 'Not on WhatsApp'},
      ],
    };

    test('reads settings, timeline, recipients and the success rate', () {
      final d = campaignDetailFrom(body);
      expect(d.campaign.name, 'Diwali offer');
      expect(d.successRate, 75);
      expect(d.settings, [
        ('Message type', 'Button'),
        ('Delay between messages', '3s'),
        ('Random jitter', '±2s'),
        ('Batch size', '20'),
        ('Pause between batches', '2 mins'),
        ('Daily send limit', '200'),
      ]);
      expect(d.recipients.length, 4);
      expect(d.recipients[3].error, 'Not on WhatsApp');
      expect(d.recipients[0].statusLabel, 'Read');
      expect(d.recipients[0].tone, RecipientTone.good);
      expect(d.recipients[3].tone, RecipientTone.bad);
      expect(d.recipients[2].tone, RecipientTone.waiting);
      expect(d.footer, 'Khatario Silks');
    });

    test('daily limit row only when set; zero recipients gives a zero rate', () {
      final b = {'campaign': {..._row(total: 0), 'daily_send_limit': null}, 'recipients': []};
      final d = campaignDetailFrom(b);
      expect(d.successRate, 0);
      expect(d.settings.any((s) => s.$1 == 'Daily send limit'), isFalse);
    });

    test('button analytics count clicks from button_clicked_id', () {
      final d = campaignDetailFrom(body);
      final stats = d.buttonStats;
      expect(stats.map((s) => s.id), ['yes', 'no', 'call_button']);
      expect(stats[0].title, 'Yes please');
      expect(stats[0].clicks, 2);
      expect(stats[0].uniqueClicks, 2);
      expect(stats[0].ctr, 50.0);
      expect(stats[1].clicks, 0);
      expect(stats[1].ctr, 0.0);
    });

    test('buttons stored as a JSON string still read', () {
      final b = {
        'campaign': {..._row(), 'buttons': '[{"type":"quick_reply","id":"a","title":"A"}]'},
        'recipients': [],
      };
      expect(campaignDetailFrom(b).buttonStats.single.title, 'A');
    });

    test('timeline lists the moments that happened', () {
      final d = campaignDetailFrom(body);
      expect(d.timeline.map((t) => t.$1), ['Created', 'Started', 'Paused']);
    });

    test('quick replies and call-to-action buttons show in the preview', () {
      final d = campaignDetailFrom(body);
      expect(d.buttonLabels, ['Yes please', 'No thanks', 'Call us (call)']);
    });
  });
}
