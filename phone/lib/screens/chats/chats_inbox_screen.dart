import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../api.dart';
import '../../session.dart';
import 'chat_outreach_screens.dart';
import 'chat_thread_logic.dart';
import 'chat_thread_screen.dart';

const _waGreen = Color(0xFF008069);
const _waInk = Color(0xFF111B21);
const _waMeta = Color(0xFF667781);
const _waUnread = Color(0xFF25D366);

/// Website conversation list: green header, search, and a WhatsApp row for each chat.
class ChatsInboxScreen extends StatefulWidget {
  const ChatsInboxScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ChatsInboxScreen> createState() => _ChatsInboxScreenState();
}

class _ChatsInboxScreenState extends State<ChatsInboxScreen> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  Timer? _debounce;
  List<Map<String, dynamic>> _rows = const [];
  InboxSummary _summary = const InboxSummary();
  String? _inboxState;
  String? _intervenedBy;
  String? _labelId;
  List<Map<String, dynamic>> _labels = const [];
  bool _unreadOnly = false;
  bool _loading = true;
  bool _loadingMore = false;
  bool _hasMore = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _loadSummary();
    _loadLabels();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_hasMore || _loadingMore || _loading) return;
    if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 240) {
      _load(more: true);
    }
  }

  Future<void> _loadSummary() async {
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/conversations/summary');
      if (!mounted) return;
      setState(() => _summary = InboxSummary.fromJson(body));
    } catch (_) {}
  }

  Future<void> _loadLabels() async {
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/labels');
      final raw = body['labels'];
      if (!mounted) return;
      setState(() {
        _labels = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
      });
    } catch (_) {}
  }

  void _selectInbox(String? state) {
    setState(() {
      _inboxState = _inboxState == state ? null : state;
      if (_inboxState != 'intervened') _intervenedBy = null;
      _unreadOnly = false;
    });
    _load();
  }

  Future<void> _load({bool more = false}) async {
    if (more) {
      setState(() => _loadingMore = true);
    } else {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final q = _search.text.trim();
      final offset = more ? _rows.length : 0;
      final filter = [
        if (_inboxState != null) 'inbox_state=$_inboxState',
        if (_inboxState == 'intervened' && _intervenedBy != null) 'intervened_by=$_intervenedBy',
        if (_unreadOnly) 'unread_only=true',
        if (_labelId != null) 'label_id=${Uri.encodeComponent(_labelId!)}',
      ].join('&');
      final path = '/api/whatsapp/conversations?limit=50&offset=$offset'
          '${q.isEmpty ? '' : '&search=${Uri.encodeComponent(q)}'}'
          '${filter.isEmpty ? '' : '&$filter'}';
      final body = await widget.session.api.getJson(path);
      final raw = body['conversations'];
      final page = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() {
        _rows = more ? [..._rows, ...page] : page;
        _hasMore = page.length == 50;
        _loading = false;
        _loadingMore = false;
      });
      if (!more) _loadSummary();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  void _onSearch(String _) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (mounted) _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: ColoredBox(
        color: Colors.white,
        child: Column(
          children: [
            _header(),
            _filters(),
            Expanded(child: _list()),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return ColoredBox(
      color: _waGreen,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: Column(
            children: [
              SizedBox(
                height: 44,
                child: Row(
                  children: [
                    const CircleAvatar(
                      radius: 18,
                      backgroundColor: Color(0x33FFFFFF),
                      child: Icon(Icons.chat_bubble, color: Colors.white, size: 18),
                    ),
                    const SizedBox(width: 10),
                    const Expanded(child: Text('Chats', style: TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w600))),
                    PopupMenuButton<String>(
                      icon: const Icon(Icons.more_vert, color: Colors.white),
                      onSelected: (value) {
                        final page = value == 'broadcasts'
                            ? BroadcastsScreen(session: widget.session)
                            : BotRepliesScreen(session: widget.session);
                        Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
                      },
                      itemBuilder: (context) => const [
                        PopupMenuItem(value: 'broadcasts', child: Text('Broadcasts')),
                        PopupMenuItem(value: 'bot', child: Text('Bot replies')),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _search,
                onChanged: _onSearch,
                style: const TextStyle(fontSize: 14, color: _waInk),
                decoration: InputDecoration(
                  hintText: 'Search name, number or message',
                  hintStyle: const TextStyle(color: Color(0xFF6B7280), fontSize: 14),
                  filled: true,
                  fillColor: Colors.white,
                  isDense: true,
                  prefixIcon: const Icon(Icons.search, size: 18, color: Color(0xFF6B7280)),
                  contentPadding: const EdgeInsets.symmetric(vertical: 10),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _filters() {
    final chips = <(String?, String, int, Color, Color)>[
      ('requesting', 'Requesting', _summary.requesting, const Color(0xFFFFFBEB), const Color(0xFFB45309)),
      ('intervened', 'Intervened', _summary.intervened, const Color(0xFFEFF6FF), const Color(0xFF1D4ED8)),
      ('active', 'Active', _summary.active, const Color(0xFFF3F4F6), const Color(0xFF374151)),
    ];
    return Material(
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Row(
              children: [
                for (final chip in chips) ...[
                  _chip(
                    label: chip.$2,
                    count: chip.$3,
                    selected: _inboxState == chip.$1 && !_unreadOnly,
                    background: chip.$4,
                    foreground: chip.$5,
                    onTap: () => _selectInbox(chip.$1),
                  ),
                  const SizedBox(width: 8),
                ],
                _chip(
                  label: 'Unread',
                  count: _summary.unread,
                  selected: _unreadOnly,
                  background: const Color(0xFFFEF2F2),
                  foreground: const Color(0xFFB91C1C),
                  onTap: () {
                    setState(() {
                      _unreadOnly = !_unreadOnly;
                      if (_unreadOnly) {
                        _inboxState = null;
                        _intervenedBy = null;
                      }
                    });
                    _load();
                  },
                ),
              ],
            ),
          ),
          if (_labels.isNotEmpty)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Row(
                children: [
                  _mini('All tags', _labelId == null, () {
                    setState(() => _labelId = null);
                    _load();
                  }),
                  for (final label in _labels)
                    _mini(label['name']?.toString() ?? 'Tag', _labelId == label['id']?.toString(), () {
                      final id = label['id']?.toString();
                      setState(() => _labelId = _labelId == id ? null : id);
                      _load();
                    }),
                ],
              ),
            ),
          if (_summary.supervisor && _inboxState == 'intervened')
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 6),
              child: Row(
                children: [
                  _mini('Anyone', _intervenedBy == null, () {
                    setState(() => _intervenedBy = null);
                    _load();
                  }),
                  _mini('Me (${_summary.intervenedByMe})', _intervenedBy == 'me', () {
                    setState(() => _intervenedBy = 'me');
                    _load();
                  }),
                  _mini('Others (${_summary.intervenedByOthers})', _intervenedBy == 'others', () {
                    setState(() => _intervenedBy = 'others');
                    _load();
                  }),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _chip({
    required String label,
    required int count,
    required bool selected,
    required Color background,
    required Color foreground,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? background : const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? foreground.withValues(alpha: 0.45) : const Color(0xFFE5E7EB)),
        ),
        child: Text('$label $count', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: selected ? foreground : _waMeta)),
      ),
    );
  }

  Widget _mini(String label, bool selected, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: selected ? const Color(0xFFDBEAFE) : Colors.white,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: const Color(0xFFBFDBFE)),
          ),
          child: Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: selected ? const Color(0xFF1E40AF) : _waMeta)),
        ),
      ),
    );
  }

  Widget _list() {
    if (_loading && _rows.isEmpty) return const Center(child: CircularProgressIndicator(color: _waGreen));
    if (_error != null && _rows.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: _waMeta)),
              const SizedBox(height: 12),
              TextButton(onPressed: _load, child: const Text('Try again')),
            ],
          ),
        ),
      );
    }
    if (_rows.isEmpty) return const Center(child: Text('No conversations found', style: TextStyle(color: _waMeta)));
    final now = DateTime.now();
    return RefreshIndicator(
      color: _waGreen,
      onRefresh: _load,
      child: ListView.builder(
        controller: _scroll,
        itemCount: _rows.length + (_loadingMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= _rows.length) {
            return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator(color: _waGreen)));
          }
          return _row(_rows[index], now);
        },
      ),
    );
  }

  Widget _row(Map<String, dynamic> row, DateTime now) {
    final title = conversationTitle(row);
    final phone = conversationPhone(row);
    final unread = conversationUnread(row);
    final badge = inboxRowBadge(row, widget.session.user['id']?.toString() ?? _summary.userId);
    final requesting = badge == 'Requesting';
    final seed = row['conversation_id']?.toString() ?? row['from_number']?.toString() ?? row['id']?.toString() ?? title;
    final hue = chatAvatarHue(seed).toDouble();
    final picture = row['profile_picture_url']?.toString();
    return InkWell(
      onTap: () {
        final id = row['id']?.toString() ?? '';
        if (id.isEmpty) return;
        Navigator.of(context).push(MaterialPageRoute(
          builder: (_) => ChatThreadScreen(
            session: widget.session,
            conversationId: id,
            title: title,
            subtitle: phone,
          ),
        ));
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: Color(0x1464748B)))),
        child: Row(
          children: [
            _avatar(title, hue, picture),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: _waInk, height: 1.15))),
                      const SizedBox(width: 8),
                      Text(chatListTime(row['last_message_at']?.toString(), now), style: const TextStyle(fontSize: 12, color: _waMeta)),
                    ],
                  ),
                  if (phone != null) ...[
                    const SizedBox(height: 2),
                    Text(phone, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: _waMeta, height: 1.3)),
                  ],
                  if (conversationLabels(row).isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Wrap(
                      spacing: 4,
                      runSpacing: 4,
                      children: [
                        for (final label in conversationLabels(row).take(3))
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF3F4F6),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFFE5E7EB)),
                            ),
                            child: Text(
                              label['name']?.toString() ?? '',
                              style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: _waInk),
                            ),
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          conversationPreview(row),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 14, color: _waMeta, height: 1.35),
                        ),
                      ),
                      if (badge != null) ...[
                        const SizedBox(width: 8),
                        Container(
                          constraints: const BoxConstraints(maxWidth: 90),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: requesting ? const Color(0xFFFEF3C7) : const Color(0xFFDBEAFE),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Text(
                            badge,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: requesting ? const Color(0xFF92400E) : const Color(0xFF1E40AF)),
                          ),
                        ),
                      ],
                      if (unread > 0) ...[
                        const SizedBox(width: 8),
                        Container(
                          constraints: const BoxConstraints(minWidth: 20),
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(color: _waUnread, borderRadius: BorderRadius.circular(12)),
                          child: Text(unread > 9 ? '9+' : '$unread', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w500)),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _avatar(String title, double hue, String? picture) {
    final letter = title.isEmpty ? '?' : title.characters.first.toUpperCase();
    final fallback = CircleAvatar(
      radius: 24,
      backgroundColor: HSLColor.fromAHSL(1, hue, 0.35, 0.45).toColor(),
      child: Text(letter, style: TextStyle(color: HSLColor.fromAHSL(1, hue, 0.8, 0.92).toColor(), fontSize: 18, fontWeight: FontWeight.w500)),
    );
    final url = picture == null || picture.isEmpty ? null : (picture.startsWith('http') ? picture : Uri.parse(apiBaseUrl).resolve(picture).toString());
    if (url == null) return fallback;
    return ClipOval(
      child: Image.network(
        url,
        width: 48,
        height: 48,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => fallback,
      ),
    );
  }
}
