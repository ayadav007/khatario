import 'dart:convert';

/// Title shown on a conversation row and in the thread header.
String conversationTitle(Map<String, dynamic> row) {
  if (row['is_group'] == true) {
    final group = row['group_name']?.toString().trim() ?? '';
    if (group.isNotEmpty) return group;
  }
  for (final key in ['customer_name', 'whatsapp_display_name', 'group_name']) {
    final value = row[key]?.toString().trim() ?? '';
    if (value.isNotEmpty) return value;
  }
  final phone = formatWaPhone(row['conversation_id']?.toString() ?? row['customer_phone']?.toString() ?? row['from_number']?.toString());
  return phone.isEmpty ? 'Chat' : phone;
}

/// Website `formatPhoneNumber` for a JID or raw digits.
String formatWaPhone(String? phone) {
  if (phone == null || phone.isEmpty) return '';
  var digits = phone.replaceAll('@s.whatsapp.net', '').replaceAll(RegExp(r'\D'), '');
  if (digits.length > 13) digits = digits.substring(digits.length - 12);
  if (digits.length == 12) return '+${digits.substring(0, 2)} ${digits.substring(2, 7)} ${digits.substring(7)}';
  if (digits.length == 11) return '+${digits.substring(0, 1)} ${digits.substring(1, 6)} ${digits.substring(6)}';
  if (digits.length == 10) return '${digits.substring(0, 5)} ${digits.substring(5)}';
  if (digits.length > 10) return '+${digits.substring(0, digits.length - 10)} ${digits.substring(digits.length - 10, digits.length - 5)} ${digits.substring(digits.length - 5)}';
  return digits;
}

String? conversationPhone(Map<String, dynamic> row) {
  if (row['is_group'] == true) return null;
  final formatted = formatWaPhone(row['customer_phone']?.toString() ?? row['from_number']?.toString());
  if (formatted.isEmpty || formatted == conversationTitle(row)) return null;
  return formatted;
}

const _mediaPreview = {
  'image': '📷 Photo',
  'video': '📹 Video',
  'audio': '🎵 Audio',
  'voice': '🎵 Voice message',
  'document': '📎 Document',
  'sticker': '🔖 Sticker',
  'location': '📍 Location',
  'contact': '👤 Contact',
  'poll': '📊 Poll',
};

/// Website `formatLastMessage`: media label, then `You:` on outgoing rows.
String formatLastMessage(String? text, String? direction) {
  final raw = text?.trim() ?? '';
  if (raw.isEmpty) return 'No messages yet';
  var preview = raw;
  for (final entry in _mediaPreview.entries) {
    final titled = '[${entry.key[0].toUpperCase()}${entry.key.substring(1)}]';
    if (raw == titled || raw.toLowerCase() == '[${entry.key}]' || raw == '[Media]') {
      preview = raw == '[Media]' ? '📎 Media' : entry.value;
      break;
    }
  }
  return direction == 'outgoing' ? 'You: $preview' : preview;
}

String conversationPreview(Map<String, dynamic> row) =>
    formatLastMessage(row['last_message_text']?.toString(), row['last_message_direction']?.toString());

/// Labels already attached to a conversation row (`labels` from the list API).
List<Map<String, dynamic>> conversationLabels(Map<String, dynamic> row) {
  final raw = row['labels'];
  if (raw is! List) return const [];
  return raw.whereType<Map>().map((label) => Map<String, dynamic>.from(label)).toList();
}

int conversationUnread(Map<String, dynamic> row) {
  final value = row['unread_count'];
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

/// Today `h:mm a`, otherwise Yesterday or `MMM d`.
String chatListTime(String? iso, DateTime now) {
  final parsed = DateTime.tryParse(iso ?? '');
  if (parsed == null) return '';
  final local = parsed.toLocal();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(local.year, local.month, local.day);
  if (day == today) return _clock(local);
  if (day == today.subtract(const Duration(days: 1))) return 'Yesterday';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return '${months[local.month - 1]} ${local.day}';
}

String chatClock(String? iso) {
  final parsed = DateTime.tryParse(iso ?? '');
  if (parsed == null) return '';
  return _clock(parsed.toLocal());
}

String _clock(DateTime local) {
  final hour = local.hour % 12 == 0 ? 12 : local.hour % 12;
  final minute = local.minute.toString().padLeft(2, '0');
  return '$hour:$minute ${local.hour < 12 ? 'am' : 'pm'}';
}

int chatAvatarHue(String id) => id.codeUnits.fold<int>(0, (sum, code) => sum + code) % 360;

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.messageId,
    required this.text,
    required this.outgoing,
    required this.createdAt,
    this.type = 'text',
    this.mediaUrl,
    this.buttonTitles = const [],
    this.senderName,
  });

  final String id;
  final String messageId;
  final String text;
  final bool outgoing;
  final String? createdAt;
  final String type;
  final String? mediaUrl;
  final List<String> buttonTitles;
  final String? senderName;

  factory ChatMessage.fromJson(Map<String, dynamic> row) {
    final text = row['message_text']?.toString() ?? '';
    final type = row['message_type']?.toString() ?? 'text';
    return ChatMessage(
      id: row['id']?.toString() ?? row['message_id']?.toString() ?? '',
      messageId: row['message_id']?.toString() ?? '',
      text: text.isNotEmpty ? text : _typeLabel(type),
      outgoing: row['direction']?.toString() == 'outgoing',
      createdAt: row['created_at']?.toString(),
      type: type,
      mediaUrl: row['media_url']?.toString(),
      buttonTitles: _buttonTitles(row['buttons']),
      senderName: row['sender_name']?.toString() ?? row['sent_by_name']?.toString(),
    );
  }
}

List<String> _buttonTitles(dynamic raw) {
  dynamic value = raw;
  if (value is String && value.trim().isNotEmpty) {
    try {
      value = jsonDecode(value);
    } catch (_) {
      return const [];
    }
  }
  if (value is! List) return const [];
  return value.whereType<Map>().map((button) => button['title']?.toString().trim() ?? '').where((title) => title.isNotEmpty).toList();
}

String _typeLabel(String type) {
  return switch (type) {
    'image' => 'Photo',
    'video' => 'Video',
    'audio' || 'ptt' => 'Voice message',
    'document' => 'Document',
    'sticker' => 'Sticker',
    _ => '',
  };
}

/// Requesting when the owner has left an intervened chat, matching the website list.
String effectiveInboxState(Map<String, dynamic> row) {
  final state = row['inbox_state']?.toString() ?? '';
  if (state == 'intervened' && row['is_owned'] == false) return 'requesting';
  return state;
}

/// Short badge on a conversation row. Groups have no owner.
String? inboxRowBadge(Map<String, dynamic> row, String? myUserId) {
  if (row['is_group'] == true) return null;
  final state = effectiveInboxState(row);
  if (state == 'requesting') return 'Requesting';
  if (state == 'intervened') {
    if (row['assigned_to']?.toString() == myUserId && myUserId != null && myUserId.isNotEmpty) return 'You';
    for (final key in ['owner_name', 'assigned_agent_name']) {
      final name = row[key]?.toString().trim() ?? '';
      if (name.isNotEmpty) return name;
    }
    return 'Intervened';
  }
  return null;
}

class InboxSummary {
  const InboxSummary({
    this.requesting = 0,
    this.intervened = 0,
    this.active = 0,
    this.unread = 0,
    this.intervenedByMe = 0,
    this.intervenedByOthers = 0,
    this.supervisor = false,
    this.userId,
  });

  final int requesting;
  final int intervened;
  final int active;
  final int unread;
  final int intervenedByMe;
  final int intervenedByOthers;
  final bool supervisor;
  final String? userId;

  factory InboxSummary.fromJson(Map<String, dynamic> body) {
    final summary = body['summary'];
    final map = summary is Map ? Map<String, dynamic>.from(summary) : body;
    final viewer = body['viewer'];
    int n(String key) {
      final value = map[key];
      if (value is num) return value.toInt();
      return int.tryParse(value?.toString() ?? '') ?? 0;
    }

    return InboxSummary(
      requesting: n('requesting'),
      intervened: n('intervened'),
      active: n('active'),
      unread: n('unread'),
      intervenedByMe: n('intervened_by_me'),
      intervenedByOthers: n('intervened_by_others'),
      supervisor: viewer is Map && viewer['is_supervisor'] == true,
      userId: viewer is Map ? viewer['user_id']?.toString() : null,
    );
  }
}

String ownershipCaption({required String? inboxState, required bool mine, String? ownerName}) {
  if (inboxState == 'intervened') {
    return mine ? "You're handling this chat" : '${ownerName ?? 'A team member'} is handling this chat';
  }
  if (inboxState == 'requesting') return 'The customer is waiting for a person';
  return 'The bot is handling this chat';
}

class ChatThread {
  const ChatThread({
    required this.messages,
    required this.hasMore,
    this.oldestCreatedAt,
    this.oldestMessageId,
    this.canReply = true,
    this.canIntervene = false,
    this.canTakeOver = false,
    this.canResolve = false,
    this.canTransfer = false,
    this.windowOpen = true,
    this.ownerName,
    this.inboxState,
    this.assignedTo,
    this.isGroup = false,
  });

  final List<ChatMessage> messages;
  final bool hasMore;
  final String? oldestCreatedAt;
  final String? oldestMessageId;
  final bool canReply;
  final bool canIntervene;
  final bool canTakeOver;
  final bool canResolve;
  final bool canTransfer;
  final bool windowOpen;
  final String? ownerName;
  final String? inboxState;
  final String? assignedTo;
  final bool isGroup;

  ChatThread copyWith({List<ChatMessage>? messages, bool? hasMore, String? oldestCreatedAt, String? oldestMessageId}) {
    return ChatThread(
      messages: messages ?? this.messages,
      hasMore: hasMore ?? this.hasMore,
      oldestCreatedAt: oldestCreatedAt ?? this.oldestCreatedAt,
      oldestMessageId: oldestMessageId ?? this.oldestMessageId,
      canReply: canReply,
      canIntervene: canIntervene,
      canTakeOver: canTakeOver,
      canResolve: canResolve,
      canTransfer: canTransfer,
      windowOpen: windowOpen,
      ownerName: ownerName,
      inboxState: inboxState,
      assignedTo: assignedTo,
      isGroup: isGroup,
    );
  }

  factory ChatThread.fromJson(Map<String, dynamic> body) {
    final raw = body['messages'];
    final messages = raw is List
        ? raw.whereType<Map>().map((row) => ChatMessage.fromJson(Map<String, dynamic>.from(row))).toList()
        : <ChatMessage>[];
    final cursor = body['oldest_cursor'];
    final ownership = body['ownership'];
    final window = body['window'];
    final owner = ownership is Map ? ownership['owner_name']?.toString() : null;
    final state = ownership is Map ? ownership['inbox_state']?.toString() : null;
    return ChatThread(
      messages: messages,
      hasMore: body['has_more'] == true,
      oldestCreatedAt: cursor is Map ? cursor['created_at']?.toString() : null,
      oldestMessageId: cursor is Map ? cursor['message_id']?.toString() : null,
      canReply: ownership is! Map || ownership['can_reply'] != false,
      canIntervene: ownership is Map && ownership['can_intervene'] == true,
      canTakeOver: ownership is Map && ownership['can_take_over'] == true,
      canResolve: ownership is Map && ownership['can_resolve'] == true,
      canTransfer: ownership is Map && ownership['can_transfer'] == true,
      windowOpen: window is! Map || window['open'] != false,
      ownerName: owner == null || owner.isEmpty ? null : owner,
      inboxState: state == null || state.isEmpty ? null : state,
      assignedTo: ownership is Map ? ownership['assigned_to']?.toString() : null,
      isGroup: ownership is Map && ownership['is_group'] == true,
    );
  }
}

/// Body for POST /api/whatsapp/conversations/:id/messages. Identity stays on the session.
Map<String, dynamic> replyBody(
  String text, {
  String? mediaUrl,
  String? fileName,
  List<Map<String, dynamic>>? buttons,
}) =>
    {
      'message_text': text.trim(),
      if (mediaUrl != null && mediaUrl.isNotEmpty) 'media_url': mediaUrl,
      if (fileName != null && fileName.isNotEmpty) 'file_name': fileName,
      if (buttons != null && buttons.isNotEmpty) 'buttons': buttons,
    };

const imageMaxBytes = 5 * 1024 * 1024;
const documentMaxBytes = 25 * 1024 * 1024;

String mimeForFileName(String name) {
  final ext = name.split('.').last.toLowerCase();
  return switch (ext) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    'pdf' => 'application/pdf',
    'txt' => 'text/plain',
    'doc' => 'application/msword',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls' => 'application/vnd.ms-excel',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    _ => 'application/octet-stream',
  };
}

/// Null when the file can go out on WhatsApp. Matches the website composer limits.
String? mediaRejectReason({required String mime, required int bytes}) {
  if (mime == 'application/octet-stream') return 'This file type cannot be sent on WhatsApp.';
  final image = mime.startsWith('image/');
  final limit = image ? imageMaxBytes : documentMaxBytes;
  if (bytes > limit) return image ? 'WhatsApp allows photos up to 5 MB' : 'WhatsApp allows files up to 25 MB';
  return null;
}

/// Quick-reply buttons, the same shape the inbox send API stores.
List<Map<String, dynamic>> quickReplyButtons(List<String> titles) {
  final buttons = <Map<String, dynamic>>[];
  for (final title in titles) {
    final trimmed = title.trim();
    if (trimmed.isEmpty) continue;
    buttons.add({'id': 'btn_${buttons.length + 1}', 'title': trimmed, 'type': 'quick_reply'});
  }
  return buttons;
}

/// Fills `{{name}}`, `{{first_name}}`, `{{phone}}` and `{{agent}}` the way the website picker does.
String fillQuickReply(String message, {String? name, String? phone, String? agent}) {
  final full = name?.trim() ?? '';
  final parts = full.split(RegExp(r'\s+')).where((part) => part.isNotEmpty);
  final first = parts.isEmpty ? '' : parts.first;
  final values = {
    'name': full,
    'first_name': first,
    'phone': phone?.trim() ?? '',
    'agent': agent?.trim() ?? '',
  };
  return message.replaceAllMapped(
    RegExp(r'\{\{\s*(name|first_name|phone|agent)\s*\}\}', caseSensitive: false),
    (match) => values[match.group(1)!.toLowerCase()] ?? '',
  );
}

/// Replies shown while the draft starts with `/` and has no space yet.
List<Map<String, dynamic>> matchingSavedReplies(String draft, List<Map<String, dynamic>> replies) {
  final text = draft.trimLeft();
  if (!text.startsWith('/') || text.contains(' ')) return const [];
  final needle = text.substring(1).toLowerCase();
  return replies.where((reply) {
    final title = reply['title']?.toString().toLowerCase() ?? '';
    final shortcut = reply['shortcut']?.toString().toLowerCase() ?? '';
    return needle.isEmpty || title.contains(needle) || shortcut.contains(needle);
  }).take(8).toList();
}

String? replyBlockReason({required bool canReply, required bool canIntervene, required bool windowOpen, String? ownerName}) {
  if (!windowOpen) {
    return 'More than 24 hours have passed since the customer last wrote. Send an approved template to restart the chat.';
  }
  if (canReply) return null;
  if (canIntervene) return 'Tap Intervene before you reply.';
  if (ownerName != null) return '$ownerName is handling this chat';
  return 'You cannot reply to this chat';
}
