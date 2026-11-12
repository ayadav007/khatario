import 'walk_data_core.dart';
import 'walk_fixtures.dart';

// Connect (WhatsApp). Leads, contacts, campaigns, pipeline, lead sources, flows, saved replies and the dashboard
// replies are copied from the connect_* tests; the inbox and chat thread follow chat_thread_logic's field names.

Map<String, dynamic> _lead(String id, String name) => {
      'id': id,
      'name': name,
      'phone': '919876510004',
      'conversation_id': 'c1',
      'message_count': 12,
      'lead_type': 'new',
      'source': 'indiamart',
      'stage_id': 's1',
      'stage_name': 'New',
      'stage_kind': 'open',
      'temperature': 'hot',
      'lead_score': 82,
      'owner_id': 'u2',
      'owner_name': 'Meena',
      'customer_id': null,
      'opened_at': '2026-11-01T05:00:00.000Z',
      'last_activity_at': '2026-11-10T05:00:00.000Z',
      'closed_at': null,
    };

Map<String, dynamic> _contact(String id, String name) => {
      'id': id,
      'phone': '919876543210',
      'name': name,
      'email': 'ravi@shop.in',
      'tags': ['vip', 'diwali'],
      'notes': 'Likes silk',
      'source': 'manual',
      'created_at': '2026-11-01T05:00:00.000Z',
      'groups': [
        {'id': 'g1', 'name': 'VIP', 'color': '#25D366'},
      ],
    };

Map<String, dynamic> _campaignRow(String id, String name) => {
      'id': id,
      'name': name,
      'message_type': 'text',
      'message_text': 'Happy Diwali! Come and see our new stock.',
      'status': 'running',
      'total_recipients': 10,
      'sent_count': 4,
      'failed_count': 1,
      'pending_count': 5,
      'created_at': '2026-11-01T05:30:00.000Z',
    };

Map<String, dynamic> _conversation() => {
      'id': 'c1',
      'conversation_id': 'c1',
      'from_number': '919876510004',
      'customer_phone': '919876510004',
      'name': 'Ravi Traders',
      'customer_name': 'Ravi Traders',
      'last_message_text': 'Do you have 20 cartons?',
      'last_message_at': '2026-11-10T05:00:00.000Z',
      'last_message_direction': 'inbound',
      'unread_count': 2,
      'labels': [
        {'id': 'b1', 'name': 'VIP'},
      ],
      'profile_picture_url': null,
      'inbox_state': 'open',
      'assigned_to': 'u1',
      'is_group': false,
      'is_owned': true,
      'ownership': 'mine',
    };

void registerConnect(WalkFixtures f) {
  const stages = {
    'stages': [
      {'id': 's1', 'name': 'New', 'kind': 'open', 'position': 1},
      {'id': 's2', 'name': 'Quoted', 'kind': 'open', 'position': 2},
      {'id': 's3', 'name': 'Lost', 'kind': 'lost', 'position': 3},
    ],
  };
  const users = {
    'users': [
      {'id': 'u1', 'name': 'Asha', 'can_receive': true},
      {'id': 'u2', 'name': 'Meena', 'can_receive': true},
    ],
  };
  const labels = {
    'labels': [
      {'id': 'b1', 'name': 'VIP'},
      {'id': 'b2', 'name': 'Wholesale'},
    ],
  };
  f.get('/api/whatsapp/status', {'status': 'connected', 'connected': true, 'phone': '919876543210'});
  f.get('/api/whatsapp/qr', {'qr': null, 'status': 'connected'});
  f.get('/api/whatsapp/pipeline/stages', stages);
  f.get('/api/whatsapp/users', users);
  f.get('/api/whatsapp/labels', labels);
  f.get('/api/whatsapp/leads', {
    'rows': [_lead('l1', 'Ravi Traders'), _lead('l2', 'Meena Silks')],
    'total': 2,
  });
  f.get('/api/whatsapp/leads/:id', {
    'lead': {
      ..._lead('l1', 'Ravi Traders'),
      'deal_value': 2500,
      'note': 'Wants 20 cartons',
      'summary': 'Asked about price',
      'source_detail': {'product': 'Cartons'},
      'followups': [
        {'id': 'f1', 'due_at': '2026-11-12T10:00:00.000Z', 'note': 'Ring him', 'assigned_name': 'Meena'},
      ],
      'other_leads': [
        {'id': 'l0', 'opened_at': '2026-09-01T00:00:00.000Z', 'closed_at': '2026-09-05T00:00:00.000Z', 'stage_name': 'Lost'},
      ],
    },
  });
  f.get('/api/whatsapp/leads/:id/notes', {
    'notes': [
      {'id': 'n1', 'note_text': 'Call back after lunch', 'created_at': '2026-11-10T05:00:00.000Z', 'user_id': 'u', 'user_name': 'Asha'},
    ],
  });
  f.get('/api/whatsapp/pipeline', {
    'is_supervisor': true,
    'columns': [
      {
        'id': 's1',
        'name': 'New',
        'kind': 'open',
        'count': 1,
        'total_value': 0,
        'cards': [
          {'id': 'a', 'stage_id': 's1', 'name': 'First Lead', 'conversation_id': 'c-a', 'last_message_text': 'hello', 'phone': '919876510004'},
        ],
      },
      {'id': 's2', 'name': 'Quoted', 'kind': 'open', 'count': 0, 'total_value': 0, 'cards': <Object>[]},
    ],
  });
  f.get('/api/whatsapp/followups', {
    'followups': [
      {'id': 'f1', 'conversation_id': 'c1', 'due_at': '2026-11-10T10:00:00.000Z', 'note': 'Ring him', 'assigned_name': 'Meena', 'name': 'Ravi Traders', 'phone': '919876510004', 'stage_id': 's1', 'kind': 'followup'},
    ],
    'stages': stages['stages'],
  });
  f.get('/api/whatsapp/contacts', {
    'contacts': [_contact('c1', 'Ravi Traders'), _contact('c2', 'Meena Silks')],
    'total': 2,
  });
  f.get('/api/whatsapp/contact-groups', {
    'groups': [
      {'id': 'g1', 'name': 'VIP', 'description': 'Best customers', 'color': '#3B82F6', 'member_count': '2'},
      {'id': 'g2', 'name': 'Wholesale', 'color': '#25D366', 'member_count': 0},
    ],
  });
  f.get('/api/whatsapp/contact-groups/:id/members', {
    'members': [_contact('c1', 'Ravi Traders')],
    'contacts': [_contact('c1', 'Ravi Traders')],
    'pagination': {'page': 1, 'limit': 50, 'total': 1, 'totalPages': 1},
  });
  f.get('/api/whatsapp/contacts/:phone', {
    'contact': {..._contact('c1', 'Ravi Traders'), 'conversation_id': 'c1'},
  });
  f.get('/api/whatsapp/contact-groups/:id', {
    'members': [_contact('c1', 'Ravi Traders')],
    'group': {'id': 'g1', 'name': 'VIP'},
  });
  f.get('/api/whatsapp/unsubscribes', {
    'unsubscribes': [
      {'id': 'u1', 'phone': '919876543299', 'name': 'Old customer', 'reason': 'Replied STOP', 'unsubscribed_at': '2026-11-02T05:00:00.000Z'},
    ],
  });
  f.get('/api/whatsapp/campaigns', {
    'campaigns': [_campaignRow('k1', 'Diwali offer'), _campaignRow('k2', 'Winter sale')],
    'total': 2,
  });
  f.get('/api/whatsapp/campaigns/:id', {
    'campaign': {
      ..._campaignRow('k1', 'Diwali offer'),
      'status': 'paused',
      'buttons': [
        {'type': 'quick_reply', 'id': 'yes', 'title': 'Yes please'},
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
      {'id': 'r4', 'phone': '919876543213', 'name': 'Meena', 'status': 'failed', 'error_message': 'Not on WhatsApp'},
    ],
  });
  f.get('/api/whatsapp/lead-sources', {
    'direct': {'enabled': true},
    'sources': [
      {
        'id': 's1',
        'kind': 'indiamart',
        'name': 'IndiaMART',
        'enabled': true,
        'has_key': true,
        'stage_id': 's1',
        'assign_to': null,
        'label_ids': ['b1'],
        'last_run_at': '2026-11-10T05:00:00.000Z',
        'last_result': {'fetched': 5, 'imported': 3},
        'last_error': null,
        'leads': 40,
      },
      {'id': 's2', 'kind': 'webhook', 'name': 'JustDial via Zapier', 'enabled': true, 'token_hint': 'a1b2', 'leads': 2, 'last_run_at': null, 'last_error': null},
    ],
  });
  f.get('/api/whatsapp/lead-sources/links', {
    'base_url': 'https://khatario.com',
    'suggested_phone': '919876543210',
    'links': [
      {'id': 'k1', 'code': 'K7Q2MX', 'name': 'Diwali poster', 'phone': '919876543210', 'prefill_text': 'Hi', 'clicks': 10, 'qr_scans': 2, 'widget_clicks': 1, 'chats': 4, 'won': 1, 'archived': false},
    ],
  });
  f.get('/api/whatsapp/flows', {
    'flows': [
      {
        'id': 'f1',
        'name': 'Shop order',
        'status': 'active',
        'version': 2,
        'updated_at': '2026-11-10T08:30:00.000Z',
        'triggers': {'hardPhrases': ['order'], 'hardRegex': <Object>[], 'firstMessage': false, 'softIntents': <Object>[]},
      },
    ],
  });
  f.get('/api/whatsapp/saved-replies', {
    'replies': [
      {'id': 'r1', 'title': 'Payment received', 'shortcut': 'pay', 'message': 'Your payment is received. Thank you!', 'category': 'payments'},
      {'id': 'r2', 'title': 'Hello', 'shortcut': null, 'message': 'Namaste! How can we help?', 'category': 'greetings'},
    ],
  });
  f.get('/api/whatsapp/inbox-settings', {'settings': {'visibility': 'all'}});
  f.get('/api/whatsapp/shop', {'settings': {'enabled': true, 'welcome_message': 'Welcome'}});
  f.get('/api/ai-agent', {'settings': {'enabled': false}, 'config': {'enabled': false}});
  f.get('/api/whatsapp/conversations', {
    'conversations': [_conversation()],
    'total': 1,
    'has_more': false,
  });
  f.get('/api/whatsapp/conversations/summary', {
    'summary': {'mine': 1, 'unassigned': 0, 'all': 1, 'unread': 2, 'open': 1, 'resolved': 0},
    'mine': 1,
    'unassigned': 0,
    'all': 1,
    'unread': 2,
  });
  f.get('/api/whatsapp/conversations/:id/messages', {
    'messages': [
      {'id': 'm1', 'message_id': 'm1', 'conversation_id': 'c1', 'direction': 'inbound', 'message_text': 'Do you have 20 cartons?', 'message_type': 'text', 'created_at': '2026-11-10T05:00:00.000Z', 'sender_name': 'Ravi Traders'},
      {'id': 'm2', 'message_id': 'm2', 'conversation_id': 'c1', 'direction': 'outbound', 'message_text': 'Yes, in stock.', 'message_type': 'text', 'created_at': '2026-11-10T05:05:00.000Z', 'sent_by_name': 'Asha'},
    ],
    'has_more': false,
    'oldest_cursor': null,
    'conversation': _conversation(),
    'window': {'open': true},
  });
  f.get('/api/whatsapp/conversations/:id/labels', labels);
  f.get('/api/whatsapp/conversations/:id', {'conversation': _conversation()});
  f.get('/api/whatsapp/who-to-message', {
    'people': [
      {'id': 'c1', 'name': 'Ravi Traders', 'phone': '919876543210', 'reason': 'Has not ordered for 30 days', 'email': null},
    ],
    'total': 1,
  });
  f.get('/api/whatsapp/orders', {
    'orders': [
      {'id': 'wo1', 'order_number': 'WA-1', 'customer_name': 'Ravi Traders', 'phone': '919876543210', 'status': 'draft', 'total': 1180, 'created_at': walkNow, 'items': <Object>[]},
    ],
  });
  f.get('/api/whatsapp/media', {'media': <Object>[]});
  f.get('/api/whatsapp/reminders', {'settings': {}, 'enabled': true, 'reminders': <Object>[]});
  f.get('/api/whatsapp/dashboard/overview', {
    'status': {'total': 12, 'open': 5, 'pending': 3, 'closed': 4, 'unread': 2},
    'botVsHuman': {'bot_handled': 6, 'human_handled': 2, 'handoff_count': 1, 'total_events': 20},
  });
  f.get('/api/whatsapp/dashboard/agents', {
    'agents': [
      {'agent_id': 'a1', 'agent_name': 'Meena', 'total_assigned': 9, 'open': 4, 'closed': 5, 'avg_response_seconds': 125.4},
    ],
  });
  f.get('/api/whatsapp/dashboard/campaigns', {
    'campaigns': {'messages_sent': 200, 'delivered': 180, 'read': 90, 'failed': 4, 'responses_received': 10},
  });
  f.get('/api/whatsapp/dashboard/pipeline', {
    'pipeline': {
      'days': 30,
      'stages': [
        {'id': 's1', 'name': 'New', 'kind': 'open', 'count': 4, 'total_value': 12000},
        {'id': 's3', 'name': 'Won', 'kind': 'won', 'count': 1, 'total_value': 5000},
      ],
      'won': {'count': 1, 'value': 5000},
      'lost': 3,
      'win_rate': 0.25,
      'by_agent': [
        {'agent_id': 'a1', 'agent_name': 'Meena', 'open': 3, 'open_value': 20000, 'won': 1, 'won_value': 5000},
      ],
      'lost_reasons': [
        {'reason': 'price too high', 'count': 2},
      ],
      'by_source': [
        {'source': 'indiamart', 'leads': 8, 'on_board': 6, 'won': 2, 'won_value': 9000},
      ],
    },
  });
}
