import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/audience_logic.dart';
import 'package:khatario_phone/screens/chats/campaigns_logic.dart';

void main() {
  group('single message', () {
    test('phone check is the website regex: 10 to 15 digits, first not zero', () {
      expect(singleSendPhoneError(''), 'Please enter a phone number');
      expect(singleSendPhoneError('0987654321'), 'Invalid phone number. Please enter a valid number with country code (10-15 digits)');
      expect(singleSendPhoneError('98765'), isNotNull);
      expect(singleSendPhoneError('+91 98765-43210'), isNull);
    });

    test('text body is to + message + message_type, phone cleaned', () {
      final body = singleSendBody(phone: '+91 98765-43210', text: 'Hello');
      expect(body, {'to': '919876543210', 'message': 'Hello', 'message_type': 'text'});
      expect(singleSendError(phone: '919876543210', text: '  ', buttons: const ButtonSet()), 'Please enter a message');
    });

    test('button body nests quick replies and calls to action, like the website', () {
      const set = ButtonSet(quickReplies: ['Yes', ' ', 'No'], phoneTitle: 'Call us', phone: '919800000000', urlTitle: 'Visit', url: 'https://khatario.com', footer: ' Thanks ');
      final body = singleSendBody(phone: '919876543210', text: 'Hi', buttons: set);
      expect(body['message_type'], 'button');
      expect(body['footer'], 'Thanks');
      expect(body['buttons'], {
        'quickReplies': ['Yes', 'No'],
        'callToActions': {
          'phone': {'title': 'Call us', 'phone': '919800000000'},
          'url': {'title': 'Visit', 'url': 'https://khatario.com'},
        },
        'footer': 'Thanks',
      });
    });

    test('button message errors, in the website words', () {
      expect(singleSendError(phone: '919876543210', text: '', buttons: const ButtonSet(quickReplies: ['A'])), 'Please enter a message');
      expect(singleSendError(phone: '919876543210', text: 'Hi', buttons: const ButtonSet()), 'Please add at least one Quick Reply or Call to Action button');
      expect(singleSendError(phone: '919876543210', text: 'Hi', buttons: const ButtonSet(phoneTitle: 'Call')), 'Phone CTA requires both title and phone number');
      expect(singleSendError(phone: '919876543210', text: 'Hi', buttons: const ButtonSet(quickReplies: ['A'], url: 'https://x.in')), 'URL CTA requires both title and URL');
      expect(singleSendError(phone: '919876543210', text: 'Hi', buttons: const ButtonSet(quickReplies: ['A'])), isNull);
    });

    test('titles are capped at 20 characters', () {
      expect(capButtonTitle('a' * 30).length, 20);
      expect(capButtonTitle('short'), 'short');
    });

    test('ask text and result', () {
      final ask = singleSendAsk('919876543210', 'Hello there');
      expect(ask.title, 'Send message?');
      expect(ask.text, contains('+91 98765 43210'));
      expect(ask.text, contains('Hello there'));
      expect(ask.confirm, 'Send');
    });

    test('no identity key in a body', () {
      final body = singleSendBody(phone: '919876543210', text: 'Hi');
      for (final k in ['business_id', 'user_id', 'created_by']) {
        expect(body.containsKey(k), isFalse);
      }
    });
  });

  group('campaign', () {
    const people = [Recipient(phone: '919876543210', name: 'Ravi'), Recipient(phone: '919876543211')];

    test('errors in the website words, first missing thing first', () {
      expect(campaignError(name: '', text: 'x', buttons: null, recipients: people), 'Campaign name is required');
      expect(campaignError(name: 'n', text: ' ', buttons: null, recipients: people), 'Message text is required');
      expect(campaignError(name: 'n', text: 'x', buttons: const ButtonSet(), recipients: people), 'Please add at least one quick reply or call-to-action');
      expect(campaignError(name: 'n', text: 'x', buttons: null, recipients: const []), 'Please add at least one recipient');
      expect(campaignError(name: 'n', text: 'x', buttons: null, recipients: people), isNull);
    });

    test('text campaign body: recipients as phone and name, anti-ban defaults, no identity', () {
      final body = campaignBody(name: ' Diwali ', text: 'Hello', buttons: null, recipients: people, antiBan: const AntiBan());
      expect(body, {
        'name': 'Diwali',
        'message_type': 'text',
        'message_text': 'Hello',
        'media_url': null,
        'buttons': null,
        'footer': null,
        'recipients': [
          {'phone': '919876543210', 'name': 'Ravi'},
          {'phone': '919876543211'},
        ],
        'delay_between_messages': 2,
        'random_delay_jitter': 2,
        'batch_size': 20,
        'pause_between_batches': 120,
        'daily_send_limit': null,
        'scheduled_at': null,
      });
      for (final k in ['business_id', 'user_id', 'created_by']) {
        expect(body.containsKey(k), isFalse);
      }
    });

    test('button campaign: buttons list with ids from titles, footer, schedule as UTC', () {
      const set = ButtonSet(quickReplies: ['Yes please!', ''], phoneTitle: 'Call us', phone: '919800000000', urlTitle: 'Visit', url: 'https://khatario.com', footer: 'Thanks');
      final when = DateTime.utc(2026, 11, 20, 4, 30);
      final body = campaignBody(
        name: 'n',
        text: 'Hi',
        buttons: set,
        recipients: people,
        antiBan: const AntiBan(delay: 3, jitter: 1, batch: 10, pause: 60, dailyLimit: 100),
        scheduledAt: when,
      );
      expect(body['message_type'], 'button');
      expect(body['buttons'], [
        {'type': 'quick_reply', 'id': 'yes_please_', 'title': 'Yes please!'},
        {'type': 'call', 'id': 'call_button', 'title': 'Call us', 'phone': '919800000000'},
        {'type': 'url', 'id': 'url_button', 'title': 'Visit', 'url': 'https://khatario.com'},
      ]);
      expect(body['footer'], 'Thanks');
      expect(body['delay_between_messages'], 3);
      expect(body['daily_send_limit'], 100);
      expect(body['scheduled_at'], '2026-11-20T04:30:00.000Z');
    });

    test('button id fallback', () {
      expect(quickReplyId('!!!'), 'button');
      expect(quickReplyId('A  B'), 'a_b');
    });

    test('anti-ban reads numbers and checks minimums', () {
      final ok = AntiBan.parse(delay: '2', jitter: '0', batch: '20', pause: '0', daily: '');
      expect(ok.dailyLimit, isNull);
      expect(antiBanError(ok), isNull);
      expect(antiBanError(const AntiBan(delay: 0)), 'Delay between messages must be at least 1 second');
      expect(antiBanError(const AntiBan(batch: 0)), 'Batch size must be at least 1');
      expect(antiBanError(const AntiBan(dailyLimit: 0)), 'Daily send limit must be at least 1');
      expect(AntiBan.parse(delay: 'x', jitter: '', batch: '', pause: '', daily: '5').delay, 2);
    });

    test('estimated sending time follows the website formula', () {
      // 100 people: avg delay 4s, 5 batches of 20 -> 5 * (20*4 + 120) = 1000s -> 17 minutes.
      expect(estimatedSendTime(const AntiBan(), 100), '17m');
      expect(estimatedSendTime(const AntiBan(), 0), '0m');
      expect(estimatedSendTime(const AntiBan(batch: 1, delay: 3600, jitter: 0, pause: 0), 2), '2h 0m');
    });

    test('ask names the recipient count and the message, and says when it goes', () {
      final now = campaignSendAsk(name: 'Diwali', text: 'Happy Diwali to you and your family', count: 2, scheduledAt: null);
      expect(now.title, 'Start campaign?');
      expect(now.text, contains('2 people'));
      expect(now.text, contains('Happy Diwali'));
      expect(now.text, contains('right away'));
      expect(now.confirm, 'Start campaign');
      final later = campaignSendAsk(name: 'Diwali', text: 'Hi', count: 1, scheduledAt: DateTime(2026, 11, 20, 16, 30));
      expect(later.title, 'Schedule campaign?');
      expect(later.text, contains('1 person'));
      expect(later.text, contains('20 Nov 2026'));
      expect(later.confirm, 'Schedule');
    });

    test('result text uses the reply: recipients added, opted-out numbers left out, status', () {
      expect(campaignCreatedText({'total_recipients': 8, 'unsubscribed_count': 0, 'status': 'running', 'auto_started': true}), 'Campaign started. 8 people will get it.');
      expect(
        campaignCreatedText({'total_recipients': 8, 'unsubscribed_count': 2, 'status': 'running', 'auto_started': true}),
        'Campaign started. 8 people will get it. 2 who opted out were left out.',
      );
      expect(campaignCreatedText({'total_recipients': 3, 'status': 'draft', 'auto_started': false}), 'Campaign saved as a draft for 3 people. Connect WhatsApp, then start it from Campaigns.');
      expect(campaignCreatedText({'total_recipients': 3, 'status': 'draft', 'auto_started': false}, scheduled: true), 'Campaign scheduled for 3 people.');
    });

    test('schedule must be in the future', () {
      expect(scheduleError(null), 'Choose a date and time');
      expect(scheduleError(DateTime.now().subtract(const Duration(minutes: 5))), 'Choose a time in the future');
      expect(scheduleError(DateTime.now().add(const Duration(hours: 1))), isNull);
    });
  });

  group('schedule slots', () {
    test('every half hour, twelve-hour labels, and day plus slot combine', () {
      expect(scheduleSlots.length, 48);
      expect(scheduleSlots.first, (0, '12:00 AM'));
      expect(scheduleSlots[19], (570, '09:30 AM'));
      expect(scheduleSlots.last, (1410, '11:30 PM'));
      expect(combineSchedule(DateTime(2026, 11, 20, 9), 570), DateTime(2026, 11, 20, 9, 30));
      expect(combineSchedule(null, 570), isNull);
      expect(combineSchedule(DateTime(2026, 11, 20), null), isNull);
    });
  });

  group('who to message continues into a campaign', () {
    test('a draft carries the people, the saved reply and the list name', () {
      final draft = SendDraft(recipients: const [Recipient(phone: '919876543210', name: 'Ravi')], text: 'Hello', campaignName: 'Top buyers');
      expect(draft.recipients.single.phone, '919876543210');
      expect(draft.text, 'Hello');
      expect(draft.campaignName, 'Top buyers');
    });
  });
}
