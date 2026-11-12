/// WhatsApp audience for the phone: contacts, contact groups, unsubscribes and "Who to message".
/// Request paths and bodies, and readers for the website's replies. Business and user always come
/// from the session on the server; nothing here ever sends them.
library;

import 'leads_logic.dart' show formatLeadPhone;

int _int(dynamic v) => v is num ? v.toInt() : int.tryParse(v?.toString() ?? '') ?? 0;
String? _str(dynamic v) {
  final s = v?.toString() ?? '';
  return s.isEmpty ? null : s;
}

List<Map<String, dynamic>> _maps(dynamic v) => v is List ? v.whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList() : const [];

// ---------------------------------------------------------------- phone numbers

/// `lib/utils/phone.ts` `normalizePhone`: digits only, 9 to 15 of them, otherwise empty.
String normalizePhone(String raw) {
  final digits = raw.replaceAll(RegExp(r'\D'), '');
  return digits.length < 9 || digits.length > 15 ? '' : digits;
}

bool isValidPhone(String raw) => normalizePhone(raw).isNotEmpty;

/// A pasted recipient: a number, "number,name" or "name,number" (`parseRecipientLine`).
({String phone, String? name})? parseRecipientLine(String line) {
  if (line.trim().isEmpty) return null;
  final parts = line.split(',').map((p) => p.trim()).toList();
  if (parts.length == 2) {
    final first = normalizePhone(parts[0]);
    final second = normalizePhone(parts[1]);
    if (first.isNotEmpty && second.isNotEmpty) return (phone: first, name: parts[1]);
    if (first.isNotEmpty) return (phone: first, name: parts[1].isEmpty ? null : parts[1]);
    if (second.isNotEmpty) return (phone: second, name: parts[0].isEmpty ? null : parts[0]);
  }
  final whole = normalizePhone(line);
  return whole.isEmpty ? null : (phone: whole, name: null);
}

/// One person a message goes to. Only the number and an optional name leave the phone.
class Recipient {
  const Recipient({required this.phone, this.name});

  final String phone;
  final String? name;

  Map<String, dynamic> toJson() => {'phone': phone, if ((name ?? '').trim().isNotEmpty) 'name': name!.trim()};
}

/// Pasted lines to recipients: invalid lines and repeated numbers are dropped.
List<Recipient> parseRecipients(String text) {
  final seen = <String>{};
  final out = <Recipient>[];
  for (final line in text.split('\n')) {
    final r = parseRecipientLine(line.trim());
    if (r == null || !seen.add(r.phone)) continue;
    out.add(Recipient(phone: r.phone, name: r.name));
  }
  return out;
}

// ---------------------------------------------------------------- contacts

const contactsPath = '/api/whatsapp/contacts';
const contactPageSize = 20;

const contactSources = <(String, String)>[('', 'All sources'), ('manual', 'Manual'), ('csv', 'CSV import'), ('group_extractor', 'Group extractor')];

String _sourceLabel(String key) {
  for (final (k, label) in contactSources) {
    if (k == key && k.isNotEmpty) return label;
  }
  return key.isEmpty ? 'Manual' : key.replaceAll('_', ' ');
}

/// `GET /api/whatsapp/contacts?limit=&offset=&search=&source=&group_id=` (the website's order).
String contactsListPath({String search = '', String source = '', String groupId = '', int offset = 0}) {
  final q = <String, String>{
    'limit': '$contactPageSize',
    'offset': '$offset',
    if (search.trim().isNotEmpty) 'search': search.trim(),
    if (source.isNotEmpty) 'source': source,
    if (groupId.isNotEmpty) 'group_id': groupId,
  };
  return Uri(path: contactsPath, queryParameters: q).toString();
}

String contactDeletePath(String id) => Uri(path: contactsPath, queryParameters: {'id': id}).toString();

/// `GET /api/whatsapp/contacts/<phone>`: the chat with that number, when there is one.
String contactChatPath(String phone) => '$contactsPath/${Uri.encodeComponent(phone.replaceAll(RegExp(r'\D'), ''))}';

String? chatIdFrom(Map<String, dynamic> body) {
  final c = body['contact'];
  return c is Map ? _str(c['conversation_id']) : null;
}

List<String> parseTags(String text) => text.split(',').map((t) => t.trim()).where((t) => t.isNotEmpty).toList();

String? contactPhoneError(String phone) {
  if (phone.trim().isEmpty) return 'Enter a phone number';
  if (!isValidPhone(phone)) return 'Enter a valid phone number with country code';
  return null;
}

Map<String, dynamic> addContactBody({required String phone, String name = '', String email = '', String tags = '', String notes = ''}) => {
      'phone': normalizePhone(phone),
      if (name.trim().isNotEmpty) 'name': name.trim(),
      if (email.trim().isNotEmpty) 'email': email.trim(),
      'tags': parseTags(tags),
      if (notes.trim().isNotEmpty) 'notes': notes.trim(),
      'source': 'manual',
    };

/// The website's edit sends `null` for a field left empty, and the tags as a list.
Map<String, dynamic> editContactBody({required String id, String name = '', String email = '', String tags = '', String notes = ''}) => {
      'id': id,
      'name': name.trim().isEmpty ? null : name.trim(),
      'email': email.trim().isEmpty ? null : email.trim(),
      'tags': parseTags(tags),
      'notes': notes.trim().isEmpty ? null : notes.trim(),
    };

class GroupTag {
  const GroupTag({required this.id, required this.name, required this.color});

  final String id, name, color;
}

class Contact {
  const Contact({
    required this.id,
    required this.phone,
    this.name,
    this.email,
    this.notes,
    this.tags = const [],
    this.source = 'manual',
    this.createdAt,
    this.groups = const [],
  });

  final String id, phone, source;
  final String? name, email, notes;
  final List<String> tags;
  final DateTime? createdAt;
  final List<GroupTag> groups;

  factory Contact.fromJson(Map<String, dynamic> j) {
    final tags = j['tags'];
    return Contact(
      id: j['id']?.toString() ?? '',
      phone: j['phone']?.toString() ?? '',
      name: _str(j['name']),
      email: _str(j['email']),
      notes: _str(j['notes']),
      tags: tags is List ? tags.map((t) => t.toString()).where((t) => t.isNotEmpty).toList() : const [],
      source: _str(j['source']) ?? 'manual',
      createdAt: DateTime.tryParse(j['created_at']?.toString() ?? '')?.toLocal(),
      groups: [for (final g in _maps(j['groups'])) GroupTag(id: g['id']?.toString() ?? '', name: g['name']?.toString() ?? '', color: _str(g['color']) ?? groupColors.first.$1)],
    );
  }

  String get title => name ?? formatLeadPhone(phone);
  String get phoneText => formatLeadPhone(phone);
  String get sourceLabel => _sourceLabel(source);
}

class ContactsPage {
  const ContactsPage({required this.rows, required this.total});

  final List<Contact> rows;
  final int total;
}

ContactsPage contactsFrom(Map<String, dynamic> body) {
  final rows = [for (final j in _maps(body['contacts'])) Contact.fromJson(j)];
  final p = body['pagination'];
  final total = p is Map ? _int(p['total']) : rows.length;
  return ContactsPage(rows: rows, total: total);
}

// ---------------------------------------------------------------- contact groups

const groupsPath = '/api/whatsapp/contact-groups';

/// The website's eight group colours as the server stores them (`#rrggbb`), with names for the picker.
const groupColors = <(String, String)>[
  ('#25D366', 'Green'),
  ('#3B82F6', 'Blue'),
  ('#EF4444', 'Red'),
  ('#F59E0B', 'Orange'),
  ('#8B5CF6', 'Purple'),
  ('#EC4899', 'Pink'),
  ('#10B981', 'Emerald'),
  ('#6366F1', 'Indigo'),
];

String groupDeletePath(String id) => Uri(path: groupsPath, queryParameters: {'id': id}).toString();
String groupMembersPath(String id) => '$groupsPath/${Uri.encodeComponent(id)}/members';
String groupMembersRemovePath(String id, List<String> contactIds) =>
    Uri(path: groupMembersPath(id), queryParameters: {'contact_ids': contactIds.join(',')}).toString();

Map<String, dynamic> addMembersBody(List<String> contactIds) => {'contact_ids': contactIds};

Map<String, dynamic> groupBody({String? id, required String name, String description = '', required String color}) => {
      'id': ?id,
      'name': name.trim(),
      if (description.trim().isNotEmpty) 'description': description.trim(),
      'color': color,
    };

class ContactGroup {
  const ContactGroup({required this.id, required this.name, this.description, this.color = '#25D366', this.memberCount = 0});

  final String id, name, color;
  final String? description;
  final int memberCount;

  factory ContactGroup.fromJson(Map<String, dynamic> j) => ContactGroup(
        id: j['id']?.toString() ?? '',
        name: j['name']?.toString() ?? '',
        description: _str(j['description']),
        color: _str(j['color']) ?? '#25D366',
        memberCount: _int(j['member_count']),
      );
}

List<ContactGroup> groupsFrom(Map<String, dynamic> body) => [for (final j in _maps(body['groups'])) ContactGroup.fromJson(j)];

List<Contact> membersFrom(Map<String, dynamic> body) => [for (final j in _maps(body['members'])) Contact.fromJson(j)];

String addedMessage(Map<String, dynamic> body) {
  final added = _int(body['added']);
  final skipped = _int(body['skipped']);
  return skipped > 0 ? '$added added, $skipped already in the group or not found' : '$added added';
}

// ---------------------------------------------------------------- unsubscribes

const unsubscribesPath = '/api/whatsapp/unsubscribes';

String unsubscribeRemovePath(String phone) => Uri(path: unsubscribesPath, queryParameters: {'phone': phone.replaceAll(RegExp(r'\D'), '')}).toString();

Map<String, dynamic> unsubscribeBody(String phone) => {'phone': normalizePhone(phone)};

String? unsubscribeError(String phone) => isValidPhone(phone) ? null : 'Please enter a valid phone number';

/// `GET /unsubscribes?check_phones=a,b`: which of these numbers have opted out.
String checkUnsubscribesPath(List<String> phones) => Uri(path: unsubscribesPath, queryParameters: {'check_phones': phones.join(',')}).toString();

class Unsubscribe {
  const Unsubscribe({required this.id, required this.phone, this.at});

  final String id, phone;
  final DateTime? at;

  String get phoneText => formatLeadPhone(phone);
}

List<Unsubscribe> unsubscribesFrom(Map<String, dynamic> body) => [
      for (final j in _maps(body['unsubscribes']))
        Unsubscribe(id: j['id']?.toString() ?? '', phone: j['phone']?.toString() ?? '', at: DateTime.tryParse(j['unsubscribed_at']?.toString() ?? '')?.toLocal()),
    ];

List<Unsubscribe> filterUnsubscribes(List<Unsubscribe> rows, String search) {
  final digits = search.trim();
  return digits.isEmpty ? rows : rows.where((r) => r.phone.contains(digits)).toList();
}

// ---------------------------------------------------------------- who to message

class WhoCondition {
  const WhoCondition(this.id, this.label, this.hint);

  final String id, label, hint;
}

const whoConditions = <WhoCondition>[
  WhoCondition('quiet', 'Has not bought in a while', 'Bought before, then went quiet'),
  WhoCondition('top', 'Top buyers', 'Highest bills in a period'),
  WhoCondition('once', 'Bought only once', 'Only one bill so far'),
  WhoCondition('enquiry', 'Store enquiry, no order', 'Asked on the store, never ordered'),
  WhoCondition('whatsapp', 'WhatsApp message, no order', 'Wrote on WhatsApp, no bill or order after'),
];

const savedRepliesPath = '/api/whatsapp/saved-replies';

/// `GET /api/whatsapp/who-to-message?condition=&days=&period_days=&limit=`: only what the list uses.
String whoToMessagePath(String condition, {required int days, required int periodDays, required int limit}) {
  final q = <String, String>{
    'condition': condition,
    if (condition == 'quiet' || condition == 'enquiry' || condition == 'whatsapp') 'days': '$days',
    if (condition == 'top') ...{'period_days': '$periodDays', 'limit': '$limit'},
  };
  return Uri(path: '/api/whatsapp/who-to-message', queryParameters: q).toString();
}

/// The server answers 400 outside these ranges; the phone says so before asking.
String? whoRangeError(String condition, {required int days, required int periodDays, required int limit}) {
  bool bad(int n, int hi) => n < 1 || n > hi;
  const daysText = 'Days must be a whole number from 1 to 365';
  if ((condition == 'quiet' || condition == 'enquiry' || condition == 'whatsapp') && bad(days, 365)) return daysText;
  if (condition == 'top') {
    if (bad(periodDays, 365)) return daysText;
    if (bad(limit, 50)) return 'Show must be a whole number from 1 to 50';
  }
  return null;
}

class WhoPerson {
  const WhoPerson({required this.phone, required this.name, required this.reason});

  final String phone, name, reason;
}

List<WhoPerson> peopleFrom(Map<String, dynamic> body) => [
      for (final j in _maps(body['people']))
        WhoPerson(phone: j['phone']?.toString() ?? '', name: _str(j['name']) ?? 'Customer', reason: j['reason']?.toString() ?? ''),
    ];

List<Recipient> whoPeopleToRecipients(List<WhoPerson> people) => [for (final p in people) Recipient(phone: p.phone, name: p.name)];

class SavedReply {
  const SavedReply({required this.id, required this.title, required this.message});

  final String id, title, message;
}

List<SavedReply> savedRepliesFrom(Map<String, dynamic> body) =>
    [for (final j in _maps(body['replies'])) SavedReply(id: j['id']?.toString() ?? '', title: j['title']?.toString() ?? '', message: j['message']?.toString() ?? '')];
