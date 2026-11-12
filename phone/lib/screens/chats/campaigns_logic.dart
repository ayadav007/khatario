/// WhatsApp campaigns and sending for the phone: the campaign list and report, and the bodies of
/// Send message (one person, or a campaign). Business and user always come from the session on the
/// server; nothing here ever sends them.
library;

import 'dart:convert';

import '../../format.dart';
import 'audience_logic.dart';

int _int(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
String? _str(dynamic v) {
  final s = v?.toString() ?? '';
  return s.isEmpty ? null : s;
}

DateTime? _date(dynamic v) => DateTime.tryParse(v?.toString() ?? '')?.toLocal();
List<Map<String, dynamic>> _maps(dynamic v) => v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : const [];
String _cap(String s) => s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';
String _people(int n) => n == 1 ? '1 person' : '$n people';

/// A yes/no question for `askSheet`.
class Ask {
  const Ask({required this.title, required this.text, required this.confirm, this.cancel = 'Not now', this.danger = false});

  final String title, text, confirm, cancel;
  final bool danger;
}

// ---------------------------------------------------------------- campaign list

const campaignsPath = '/api/whatsapp/campaigns';
const campaignPageSize = 20;
const whatsappStatusPath = '/api/whatsapp/status';

const campaignStatusFilters = <(String, String)>[
  ('all', 'All status'),
  ('draft', 'Draft'),
  ('running', 'Running'),
  ('paused', 'Paused'),
  ('completed', 'Completed'),
  ('failed', 'Failed'),
];

/// `GET /api/whatsapp/campaigns?limit=&offset=&status=&search=` (the website's order).
String campaignsListPath({String search = '', String status = 'all', int offset = 0}) {
  final q = <String, String>{
    'limit': '$campaignPageSize',
    'offset': '$offset',
    'status': status,
    if (search.trim().isNotEmpty) 'search': search.trim(),
  };
  return Uri(path: campaignsPath, queryParameters: q).toString();
}

String campaignPath(String id) => '$campaignsPath/${Uri.encodeComponent(id)}';

enum CampaignAction { start, pause, resume }

Map<String, dynamic> campaignActionBody(CampaignAction a) => {'action': a.name};

bool whatsappConnected(Map<String, dynamic> status) => status['status'] == 'connected';

String notConnectedMessage(String _) =>
    'WhatsApp is not connected. Please connect your WhatsApp account via Settings before starting/resuming a campaign.';

String campaignDoneText(CampaignAction a) => switch (a) {
      CampaignAction.start => 'Campaign started successfully',
      CampaignAction.pause => 'Campaign paused successfully',
      CampaignAction.resume => 'Campaign resumed successfully',
    };

class CampaignRow {
  const CampaignRow({
    required this.id,
    required this.name,
    required this.messageType,
    required this.messageText,
    required this.status,
    required this.total,
    required this.sent,
    required this.failed,
    required this.pending,
    this.createdAt,
  });

  final String id, name, messageType, messageText, status;
  final int total, sent, failed, pending;
  final DateTime? createdAt;

  factory CampaignRow.fromJson(Map<String, dynamic> j) => CampaignRow(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? 'Campaign',
        messageType: _str(j['message_type']) ?? 'text',
        messageText: j['message_text']?.toString() ?? '',
        status: _str(j['status']) ?? 'draft',
        total: _int(j['total_recipients']),
        sent: _int(j['sent_count']),
        failed: _int(j['failed_count']),
        pending: _int(j['pending_count']),
        createdAt: _date(j['created_at']),
      );

  String get type => _cap(messageType);
  String get statusLabel => _cap(status);

  /// Share of recipients already tried (sent or failed), as the website's bar.
  int get progress => total == 0 ? 0 : ((sent + failed) / total * 100).round();

  String get countsText => '$sent sent / $failed failed / $pending pending';

  /// The first 60 characters of the message, as the website's list shows.
  String get preview => messageText.length > 60 ? '${messageText.substring(0, 60)}...' : messageText;

  bool get canStart => status == 'draft';
  bool get canPause => status == 'running';
  bool get canResume => status == 'paused';
  bool get canRestart => status == 'paused';
  bool get canDelete => status != 'running';
}

({List<CampaignRow> rows, int total}) campaignsFrom(Map<String, dynamic> body) {
  final rows = [for (final j in _maps(body['campaigns'])) CampaignRow.fromJson(j)];
  return (rows: rows, total: body['total'] == null ? rows.length : _int(body['total']));
}

Ask campaignAsk(CampaignRow c, CampaignAction a) {
  final message = '\n\n"${_short(c.messageText)}"';
  switch (a) {
    case CampaignAction.start:
      final again = c.status == 'paused';
      return Ask(
        title: again ? 'Restart campaign?' : 'Start campaign?',
        text: again
            ? 'Restart "${c.name}"? It will send to the ${_people(c.pending)} still waiting.$message'
            : 'Start "${c.name}" now? It will send to ${_people(c.total)}.$message',
        confirm: again ? 'Restart' : 'Start',
      );
    case CampaignAction.pause:
      return Ask(title: 'Pause campaign?', text: 'Pause "${c.name}"? ${c.pending} messages stay waiting until you resume it.$message', confirm: 'Pause');
    case CampaignAction.resume:
      return Ask(title: 'Resume campaign?', text: 'Resume "${c.name}"? The ${c.pending} messages still waiting will go out.$message', confirm: 'Resume');
  }
}

Ask campaignDeleteAsk(CampaignRow c) => Ask(
      title: 'Delete campaign?',
      text: 'Delete "${c.name}"? This cannot be undone and removes all its recipient data.',
      confirm: 'Delete campaign',
      cancel: 'Keep it',
      danger: true,
    );

// ---------------------------------------------------------------- campaign report

enum RecipientTone { good, bad, waiting }

class CampaignRecipient {
  const CampaignRecipient({required this.id, required this.phone, this.name, required this.status, this.error, this.sentAt, this.clickedId});

  final String id, phone, status;
  final String? name, error, clickedId;
  final DateTime? sentAt;

  String get statusLabel => _cap(status);
  String get title => name ?? formatPhoneForList(phone);
  RecipientTone get tone => switch (status) {
        'sent' || 'delivered' || 'read' => RecipientTone.good,
        'failed' => RecipientTone.bad,
        _ => RecipientTone.waiting,
      };
}

String formatPhoneForList(String phone) => Contact(id: '', phone: phone).phoneText;

class CampaignButton {
  const CampaignButton({required this.id, required this.title, required this.type});

  final String id, title, type;
}

class ButtonStat {
  const ButtonStat({required this.id, required this.title, required this.clicks, required this.uniqueClicks, required this.ctr});

  final String id, title;
  final int clicks, uniqueClicks;

  /// Unique clicks over all recipients, in percent to two decimals.
  final double ctr;
}

class CampaignDetail {
  const CampaignDetail({
    required this.campaign,
    required this.footer,
    required this.settings,
    required this.timeline,
    required this.recipients,
    required this.buttons,
  });

  final CampaignRow campaign;
  final String? footer;
  final List<(String, String)> settings;
  final List<(String, DateTime)> timeline;
  final List<CampaignRecipient> recipients;
  final List<CampaignButton> buttons;

  int get successRate => campaign.total == 0 ? 0 : (campaign.sent / campaign.total * 100).round();

  List<String> get buttonLabels => [
        for (final b in buttons)
          switch (b.type) {
            'call' => '${b.title} (call)',
            'url' => '${b.title} (link)',
            _ => b.title,
          },
      ];

  /// Clicks per button, counted from `button_clicked_id`, the field the campaign API returns. The
  /// server never writes it today, so every count is 0 until it records button replies (server follow-up).
  List<ButtonStat> get buttonStats {
    final total = campaign.total;
    return [
      for (final b in buttons)
        () {
          final hits = recipients.where((r) => r.clickedId == b.id).toList();
          final unique = hits.map((r) => r.phone).toSet().length;
          final ctr = total == 0 ? 0.0 : (unique / total * 100 * 100).round() / 100;
          return ButtonStat(id: b.id, title: b.title, clicks: hits.length, uniqueClicks: unique, ctr: ctr);
        }(),
    ];
  }
}

List<CampaignButton> _buttonsFrom(dynamic raw) {
  var list = raw;
  if (raw is String && raw.isNotEmpty) {
    try {
      list = jsonDecode(raw);
    } catch (_) {
      list = null;
    }
  }
  return [
    for (final b in _maps(list))
      if ((b['id']?.toString() ?? '').isNotEmpty) CampaignButton(id: b['id'].toString(), title: b['title']?.toString() ?? b['id'].toString(), type: b['type']?.toString() ?? 'quick_reply'),
  ];
}

String _mins(num seconds) {
  final m = seconds / 60;
  return m == m.truncate() ? '${m.truncate()} mins' : '${m.toStringAsFixed(1)} mins';
}

CampaignDetail campaignDetailFrom(Map<String, dynamic> body) {
  final c = Map<String, dynamic>.from(body['campaign'] as Map);
  final row = CampaignRow.fromJson(c);
  final daily = _int(c['daily_send_limit']);
  final moments = <(String, DateTime?)>[
    ('Created', _date(c['created_at'])),
    ('Started', _date(c['started_at'])),
    ('Paused', _date(c['paused_at'])),
    ('Completed', _date(c['completed_at'])),
    ('Last sent', _date(c['last_sent_at'])),
  ];
  return CampaignDetail(
    campaign: row,
    footer: _str(c['footer']),
    settings: [
      ('Message type', row.type),
      ('Delay between messages', '${_int(c['delay_between_messages'])}s'),
      ('Random jitter', '±${_int(c['random_delay_jitter'])}s'),
      ('Batch size', '${_int(c['batch_size'])}'),
      ('Pause between batches', _mins(_int(c['pause_between_batches']))),
      if (daily > 0) ('Daily send limit', '$daily'),
    ],
    timeline: [for (final (label, at) in moments) if (at != null) (label, at)],
    recipients: [
      for (final r in _maps(body['recipients']))
        CampaignRecipient(
          id: r['id']?.toString() ?? '',
          phone: r['phone']?.toString() ?? '',
          name: _str(r['name']),
          status: _str(r['status']) ?? 'pending',
          error: _str(r['error_message']),
          sentAt: _date(r['sent_at']),
          clickedId: _str(r['button_clicked_id']),
        ),
    ],
    buttons: _buttonsFrom(c['buttons']),
  );
}

// ---------------------------------------------------------------- send: one person

const sendPath = '/api/whatsapp/send';

/// Quick replies and call-to-action buttons of a message (website: up to 3 quick replies, 1 call, 1 link).
class ButtonSet {
  const ButtonSet({this.quickReplies = const [], this.phoneTitle = '', this.phone = '', this.urlTitle = '', this.url = '', this.footer = ''});

  final List<String> quickReplies;
  final String phoneTitle, phone, urlTitle, url, footer;

  List<String> get replies => quickReplies.map((r) => r.trim()).where((r) => r.isNotEmpty).toList();
  bool get hasPhone => phoneTitle.trim().isNotEmpty && phone.trim().isNotEmpty;
  bool get hasUrl => urlTitle.trim().isNotEmpty && url.trim().isNotEmpty;
  bool get hasActions => replies.isNotEmpty || hasPhone || hasUrl;

  String? get ctaError {
    final phoneStarted = phoneTitle.trim().isNotEmpty || phone.trim().isNotEmpty;
    final urlStarted = urlTitle.trim().isNotEmpty || url.trim().isNotEmpty;
    if (phoneStarted && !hasPhone) return 'Phone CTA requires both title and phone number';
    if (urlStarted && !hasUrl) return 'URL CTA requires both title and URL';
    return null;
  }
}

String capButtonTitle(String s) => s.length > 20 ? s.substring(0, 20) : s;

final _singlePhone = RegExp(r'^[1-9]\d{9,14}$');
String _cleanPhone(String s) => s.replaceAll(RegExp(r'[\s\-+]'), '');

String? singleSendPhoneError(String phone) {
  if (phone.trim().isEmpty) return 'Please enter a phone number';
  if (!_singlePhone.hasMatch(_cleanPhone(phone))) return 'Invalid phone number. Please enter a valid number with country code (10-15 digits)';
  return null;
}

/// [buttons] is null for a plain text message.
String? singleSendError({required String phone, required String text, ButtonSet? buttons, bool image = false, String? mediaUrl}) {
  final p = singleSendPhoneError(phone);
  if (p != null) return p;
  if (image && (mediaUrl ?? '').isEmpty) return 'Please select an image';
  if (text.trim().isEmpty) return image ? 'Please enter a caption for the image' : 'Please enter a message';
  if (buttons != null) {
    if (!buttons.hasActions && buttons.ctaError == null) return 'Please add at least one Quick Reply or Call to Action button';
    return buttons.ctaError;
  }
  return null;
}

/// `POST /api/whatsapp/send`: `{to, message, message_type, buttons?, footer?}`. The server gets the
/// business and the sender from the session.
Map<String, dynamic> singleSendBody({required String phone, required String text, ButtonSet? buttons, bool image = false, String? mediaUrl}) {
  final footer = buttons?.footer.trim() ?? '';
  return {
    'to': _cleanPhone(phone),
    'message': text,
    'message_type': image ? 'image' : (buttons == null ? 'text' : 'button'),
    if (image) 'mediaUrl': mediaUrl,
    if (buttons != null) ...{
      'buttons': {
        'quickReplies': buttons.replies,
        'callToActions': {
          if (buttons.hasPhone) 'phone': {'title': buttons.phoneTitle.trim(), 'phone': buttons.phone.trim()},
          if (buttons.hasUrl) 'url': {'title': buttons.urlTitle.trim(), 'url': buttons.url.trim()},
        },
        if (footer.isNotEmpty) 'footer': footer,
      },
      if (footer.isNotEmpty) 'footer': footer,
    },
  };
}

String _short(String s, [int n = 80]) => s.length > n ? '${s.substring(0, n)}...' : s;

Ask singleSendAsk(String phone, String text) => Ask(
      title: 'Send message?',
      text: 'Send this to ${Contact(id: '', phone: _cleanPhone(phone)).phoneText}?\n\n"${_short(text)}"',
      confirm: 'Send',
    );

// ---------------------------------------------------------------- send: campaign

/// Slow, human-looking sending (website "Anti-Ban & Sending Controls"); the numbers are seconds
/// except the batch size and the daily limit.
class AntiBan {
  const AntiBan({this.delay = 2, this.jitter = 2, this.batch = 20, this.pause = 120, this.dailyLimit});

  final int delay, jitter, batch, pause;
  final int? dailyLimit;

  factory AntiBan.parse({required String delay, required String jitter, required String batch, required String pause, required String daily}) {
    final d = int.tryParse(daily.trim());
    return AntiBan(
      delay: int.tryParse(delay.trim()) ?? 2,
      jitter: int.tryParse(jitter.trim()) ?? 2,
      batch: int.tryParse(batch.trim()) ?? 20,
      pause: int.tryParse(pause.trim()) ?? 120,
      dailyLimit: d,
    );
  }
}

String? antiBanError(AntiBan a) {
  if (a.delay < 1) return 'Delay between messages must be at least 1 second';
  if (a.jitter < 0) return 'Random variation cannot be negative';
  if (a.batch < 1) return 'Batch size must be at least 1';
  if (a.pause < 0) return 'Pause between batches cannot be negative';
  if (a.dailyLimit != null && a.dailyLimit! < 1) return 'Daily send limit must be at least 1';
  return null;
}

String estimatedSendTime(AntiBan a, int count) {
  if (count == 0) return '0m';
  final batches = (count / a.batch).ceil();
  final perBatch = a.batch * (a.delay + a.jitter) + a.pause;
  final seconds = batches * perBatch;
  final hours = seconds ~/ 3600;
  final minutes = ((seconds % 3600) / 60).ceil();
  return hours > 0 ? '${hours}h ${minutes}m' : '${minutes}m';
}

String quickReplyId(String title) {
  final id = title.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]'), '_').replaceAll(RegExp(r'_+'), '_');
  return id.isEmpty || id == '_' ? 'button' : id;
}

String? scheduleError(DateTime? at, {DateTime? now}) {
  if (at == null) return 'Choose a date and time';
  if (!at.isAfter(now ?? DateTime.now())) return 'Choose a time in the future';
  return null;
}

String? campaignError({required String name, required String text, ButtonSet? buttons, required List<Recipient> recipients, bool image = false, String? mediaUrl}) {
  if (name.trim().isEmpty) return 'Campaign name is required';
  if (text.trim().isEmpty) return 'Message text is required';
  if (image && (mediaUrl ?? '').isEmpty) return 'Please select an image';
  if (buttons != null && !buttons.hasActions) return 'Please add at least one quick reply or call-to-action';
  if (recipients.isEmpty) return 'Please add at least one recipient';
  return null;
}

/// `POST /api/whatsapp/campaigns`. Recipients are phones and names; the server drops opted-out
/// numbers and starts the campaign at once unless [scheduledAt] is set.
Map<String, dynamic> campaignBody({
  required String name,
  required String text,
  ButtonSet? buttons,
  required List<Recipient> recipients,
  required AntiBan antiBan,
  bool image = false,
  String? mediaUrl,
  DateTime? scheduledAt,
}) {
  final list = <Map<String, dynamic>>[];
  if (buttons != null) {
    for (final r in buttons.replies) {
      list.add({'type': 'quick_reply', 'id': quickReplyId(r), 'title': r});
    }
    if (buttons.hasPhone) list.add({'type': 'call', 'id': 'call_button', 'title': buttons.phoneTitle.trim(), 'phone': buttons.phone.trim()});
    if (buttons.hasUrl) list.add({'type': 'url', 'id': 'url_button', 'title': buttons.urlTitle.trim(), 'url': buttons.url.trim()});
  }
  final footer = buttons?.footer.trim() ?? '';
  return {
    'name': name.trim(),
    'message_type': image ? 'image' : (buttons == null ? 'text' : 'button'),
    'message_text': text,
    'media_url': image || buttons != null ? mediaUrl : null,
    'buttons': list.isEmpty ? null : list,
    'footer': footer.isEmpty ? null : footer,
    'recipients': [for (final r in recipients) r.toJson()],
    'delay_between_messages': antiBan.delay,
    'random_delay_jitter': antiBan.jitter,
    'batch_size': antiBan.batch,
    'pause_between_batches': antiBan.pause,
    'daily_send_limit': antiBan.dailyLimit,
    'scheduled_at': scheduledAt?.toUtc().toIso8601String(),
  };
}

Ask campaignSendAsk({required String name, required String text, required int count, DateTime? scheduledAt}) {
  final message = '"${_short(text)}"';
  if (scheduledAt != null) {
    return Ask(
      title: 'Schedule campaign?',
      text: 'Schedule "$name" for ${_people(count)} on ${ddMMMyyyyHm(scheduledAt)}?\n\n$message',
      confirm: 'Schedule',
    );
  }
  return Ask(
    title: 'Start campaign?',
    text: 'Send "$name" to ${_people(count)} right away? Numbers that opted out are left out.\n\n$message',
    confirm: 'Start campaign',
  );
}

String campaignCreatedText(Map<String, dynamic> reply, {bool scheduled = false}) {
  final n = _int(reply['total_recipients']);
  final left = _int(reply['unsubscribed_count']);
  final out = left > 0 ? ' $left who opted out ${left == 1 ? 'was' : 'were'} left out.' : '';
  if (reply['auto_started'] == true) return 'Campaign started. ${_people(n)} will get it.$out';
  if (scheduled) return 'Campaign scheduled for ${_people(n)}.$out';
  return 'Campaign saved as a draft for ${_people(n)}. Connect WhatsApp, then start it from Campaigns.$out';
}

/// What Who to message hands to Send message: the people, a saved reply and the list's name.
class SendDraft {
  const SendDraft({required this.recipients, this.text = '', this.campaignName = ''});

  final List<Recipient> recipients;
  final String text, campaignName;
}

// ---------------------------------------------------------------- schedule

/// Start times the phone offers, every half hour, as minutes after midnight.
final scheduleSlots = <(int, String)>[
  for (var m = 0; m < 24 * 60; m += 30) (m, _slotLabel(m)),
];

String _slotLabel(int minutes) {
  final h = minutes ~/ 60;
  final m = minutes % 60;
  final hour12 = h % 12 == 0 ? 12 : h % 12;
  return '${hour12.toString().padLeft(2, '0')}:${m.toString().padLeft(2, '0')} ${h < 12 ? 'AM' : 'PM'}';
}

/// The chosen day at the chosen slot, in the phone's time zone; null until both are chosen.
DateTime? combineSchedule(DateTime? day, int? minutes) =>
    day == null || minutes == null ? null : DateTime(day.year, day.month, day.day, minutes ~/ 60, minutes % 60);

// ---------------------------------------------------------------- pictures

const mediaPath = '/api/whatsapp/media';
const mediaMaxBytes = 5 * 1024 * 1024;
const _mediaTypes = {'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'};

/// The media route's own limits, said before uploading.
String? mediaUploadError({required String mime, required int bytes}) {
  if (!_mediaTypes.contains(mime)) return 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.';
  if (bytes > mediaMaxBytes) return 'File size too large. Maximum size is 5MB.';
  return null;
}

/// A picture in the media library; [url] is the `data:` URL the send and campaign routes accept.
class MediaItem {
  const MediaItem({required this.id, required this.name, required this.url, this.size = 0});

  final String id, name, url;
  final int size;

  factory MediaItem.fromJson(Map<String, dynamic> j) => MediaItem(
        id: j['id']?.toString() ?? '',
        name: _str(j['original_filename']) ?? _str(j['filename']) ?? 'Picture',
        url: j['media_url']?.toString() ?? '',
        size: _int(j['file_size']),
      );
}

List<MediaItem> mediaFrom(Map<String, dynamic> body) => [for (final j in _maps(body['media'])) MediaItem.fromJson(j)];

MediaItem? uploadedMediaFrom(Map<String, dynamic> body) {
  final m = body['media'];
  if (m is! Map) return null;
  final item = MediaItem.fromJson(Map<String, dynamic>.from(m));
  return item.url.isEmpty ? null : item;
}
