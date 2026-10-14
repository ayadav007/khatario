import 'package:flutter_test/flutter_test.dart';
import 'package:khatario_phone/screens/chats/chat_thread_logic.dart';

void main() {
  test('a conversation is named from the customer, then the WhatsApp name, then the number', () {
    expect(conversationTitle({'customer_name': 'Ravi', 'from_number': '9198'}), 'Ravi');
    expect(conversationTitle({'is_group': true, 'group_name': 'Shop staff'}), 'Shop staff');
    expect(conversationTitle({'from_number': '919876543210'}), '+91 98765 43210');
    expect(conversationPreview({'last_message_text': 'Send the bill', 'last_message_direction': 'outgoing'}), 'You: Send the bill');
    expect(conversationPreview({'last_message_text': '[Image]'}), '📷 Photo');
    expect(conversationUnread({'unread_count': 12}), 12);
    expect(chatListTime('2026-10-14T04:30:00Z', DateTime.utc(2026, 10, 14, 5).toLocal()), isNotEmpty);
  });

  test('messages keep order and a reply body omits identity fields', () {
    final thread = ChatThread.fromJson({
      'messages': [
        {'id': '1', 'message_id': 'm1', 'message_text': 'Hi', 'direction': 'incoming', 'created_at': '2026-10-14T01:00:00Z'},
        {'id': '2', 'message_id': 'm2', 'message_text': 'Hello', 'direction': 'outgoing', 'created_at': '2026-10-14T01:01:00Z'},
      ],
      'has_more': true,
      'oldest_cursor': {'created_at': '2026-10-14T01:00:00Z', 'message_id': 'm1'},
      'ownership': {'can_reply': true, 'can_intervene': false},
      'window': {'open': true},
    });
    expect(thread.messages.map((m) => m.text).toList(), ['Hi', 'Hello']);
    expect(thread.messages.last.outgoing, isTrue);
    expect(thread.hasMore, isTrue);
    expect(thread.oldestMessageId, 'm1');
    final body = replyBody('  Thanks  ');
    expect(body, {'message_text': 'Thanks'});
    expect(body.containsKey('business_id'), isFalse);
    expect(body.containsKey('user_id'), isFalse);
  });

  test('requesting and intervened match the website inbox', () {
    expect(effectiveInboxState({'inbox_state': 'intervened', 'is_owned': false}), 'requesting');
    expect(effectiveInboxState({'inbox_state': 'intervened', 'is_owned': true}), 'intervened');
    expect(inboxRowBadge({'inbox_state': 'requesting'}, 'me'), 'Requesting');
    expect(inboxRowBadge({'is_group': true, 'inbox_state': 'requesting'}, 'me'), isNull);
    expect(
      inboxRowBadge({'inbox_state': 'intervened', 'is_owned': true, 'assigned_to': 'me'}, 'me'),
      'You',
    );
    expect(
      inboxRowBadge({'inbox_state': 'intervened', 'is_owned': true, 'assigned_to': 'other', 'owner_name': 'Meera'}, 'me'),
      'Meera',
    );
    final summary = InboxSummary.fromJson({
      'summary': {'requesting': 2, 'intervened': 1, 'active': 4, 'unread': 3},
      'viewer': {'user_id': 'me', 'is_supervisor': true},
    });
    expect(summary.requesting, 2);
    expect(summary.supervisor, isTrue);
    expect(ownershipCaption(inboxState: 'requesting', mine: false, ownerName: null), 'The customer is waiting for a person');
  });

  test('a closed window and someone else owning the chat block the reply box', () {
    expect(
      replyBlockReason(canReply: true, canIntervene: false, windowOpen: false),
      contains('24 hours'),
    );
    expect(
      replyBlockReason(canReply: false, canIntervene: true, windowOpen: true),
      'Tap Intervene before you reply.',
    );
    expect(
      replyBlockReason(canReply: false, canIntervene: false, windowOpen: true, ownerName: 'Meera'),
      'Meera is handling this chat',
    );
    expect(replyBlockReason(canReply: true, canIntervene: false, windowOpen: true), isNull);
  });
}
