import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../../api.dart';
import '../../session.dart';
import 'chat_thread_logic.dart';

/// One WhatsApp conversation: read the messages and send a text reply.
class ChatThreadScreen extends StatefulWidget {
  const ChatThreadScreen({super.key, required this.session, required this.conversationId, required this.title, this.subtitle});

  final AppSession session;
  final String conversationId;
  final String title;
  final String? subtitle;

  @override
  State<ChatThreadScreen> createState() => _ChatThreadScreenState();
}

class _ChatThreadScreenState extends State<ChatThreadScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  ChatThread? _thread;
  List<Map<String, dynamic>> _replies = const [];
  bool _repliesLoaded = false;
  ({String name, String mime, List<int> bytes})? _file;
  List<String> _buttons = const [];
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  String get _path => '/api/whatsapp/conversations/${Uri.encodeComponent(widget.conversationId)}';

  Future<void> _load({String? beforeCreatedAt, String? beforeMessageId}) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = beforeCreatedAt != null && beforeMessageId != null
          ? '?limit=50&before_created_at=${Uri.encodeComponent(beforeCreatedAt)}&before_message_id=${Uri.encodeComponent(beforeMessageId)}'
          : '?limit=50';
      final body = await widget.session.api.getJson('$_path/messages$query');
      final page = ChatThread.fromJson(body);
      if (!mounted) return;
      setState(() {
        if (beforeCreatedAt == null || _thread == null) {
          _thread = page;
        } else {
          _thread = _thread!.copyWith(
            messages: [...page.messages, ..._thread!.messages],
            hasMore: page.hasMore,
            oldestCreatedAt: page.oldestCreatedAt,
            oldestMessageId: page.oldestMessageId,
          );
        }
        _loading = false;
      });
      if (beforeCreatedAt == null) _jumpToEnd();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    }
  }

  void _jumpToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    });
  }

  Future<void> _ownership(String action, {String? toUserId}) async {
    setState(() => _sending = true);
    try {
      await widget.session.api.postJson('$_path/ownership', {
        'action': action,
        'to_user_id': ?toUserId,
      });
      if (!mounted) return;
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _ensureReplies() async {
    if (_repliesLoaded) return;
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/saved-replies');
      final raw = body['replies'];
      if (!mounted) return;
      setState(() {
        _replies = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
        _repliesLoaded = true;
      });
    } catch (_) {
      if (mounted) setState(() => _repliesLoaded = true);
    }
  }

  void _applyReply(Map<String, dynamic> reply) {
    final filled = fillQuickReply(
      reply['message']?.toString() ?? '',
      name: widget.title,
      phone: widget.subtitle,
      agent: widget.session.userName,
    );
    _input.text = filled;
    _input.selection = TextSelection.collapsed(offset: filled.length);
    setState(() {});
  }

  Future<void> _openReplies() async {
    await _ensureReplies();
    if (!mounted) return;
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        if (_replies.isEmpty) {
          return const Padding(
            padding: EdgeInsets.all(24),
            child: Text('No saved replies yet. Add them from the website inbox, then they show up here.'),
          );
        }
        return ListView(
          children: [
            const ListTile(title: Text('Saved replies', style: TextStyle(fontWeight: FontWeight.w600))),
            for (final reply in _replies)
              ListTile(
                title: Text(reply['title']?.toString() ?? 'Reply'),
                subtitle: Text(
                  reply['shortcut']?.toString().isNotEmpty == true ? '/${reply['shortcut']}' : (reply['message']?.toString() ?? ''),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: () => Navigator.pop(context, reply),
              ),
          ],
        );
      },
    );
    if (picked != null) _applyReply(picked);
  }

  Future<void> _transfer() async {
    List<Map<String, dynamic>> people = const [];
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/users');
      final raw = body['users'];
      people = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
      return;
    }
    if (!mounted) return;
    final assigned = _thread?.assignedTo;
    final choices = people.where((person) => person['can_receive'] != false && person['id']?.toString() != assigned).toList();
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        if (choices.isEmpty) {
          return const Padding(padding: EdgeInsets.all(24), child: Text('No other team member can receive chats.'));
        }
        return ListView(
          children: [
            const ListTile(title: Text('Transfer chat', style: TextStyle(fontWeight: FontWeight.w600))),
            for (final person in choices)
              ListTile(
                leading: Icon(Icons.circle, size: 10, color: person['online'] == true ? const Color(0xFF16A34A) : const Color(0xFFD1D5DB)),
                title: Text(person['name']?.toString() ?? 'Team member'),
                subtitle: Text(person['online'] == true ? 'Online' : 'Offline'),
                onTap: () => Navigator.pop(context, person['id']?.toString()),
              ),
          ],
        );
      },
    );
    if (picked != null && picked.isNotEmpty) await _ownership('transfer', toUserId: picked);
  }

  Future<void> _tags() async {
    List<Map<String, dynamic>> catalog = const [];
    List<Map<String, dynamic>> current = const [];
    try {
      final all = await widget.session.api.getJson('/api/whatsapp/labels');
      final mine = await widget.session.api.getJson('$_path/labels');
      final rawAll = all['labels'];
      final rawMine = mine['labels'];
      catalog = rawAll is List ? rawAll.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
      current = rawMine is List ? rawMine.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
      return;
    }
    if (!mounted) return;
    final selected = current.map((label) => label['id']?.toString()).whereType<String>().toSet();
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheet) {
            if (catalog.isEmpty) {
              return const Padding(padding: EdgeInsets.all(24), child: Text('No tags yet. Create them from the website inbox.'));
            }
            return ListView(
              children: [
                const ListTile(title: Text('Tags', style: TextStyle(fontWeight: FontWeight.w600))),
                for (final label in catalog)
                  CheckboxListTile(
                    value: selected.contains(label['id']?.toString()),
                    title: Text(label['name']?.toString() ?? 'Tag'),
                    controlAffinity: ListTileControlAffinity.leading,
                    onChanged: (on) async {
                      final id = label['id']?.toString();
                      if (id == null || id.isEmpty) return;
                      setSheet(() {
                        if (on == true) {
                          selected.add(id);
                        } else {
                          selected.remove(id);
                        }
                      });
                      try {
                        if (on == true) {
                          await widget.session.api.postJson('$_path/labels', {'label_id': id});
                        } else {
                          await widget.session.api.deleteJson('$_path/labels?label_id=${Uri.encodeComponent(id)}');
                        }
                      } on ApiException catch (error) {
                        if (!context.mounted) return;
                        setSheet(() {
                          if (on == true) {
                            selected.remove(id);
                          } else {
                            selected.add(id);
                          }
                        });
                        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.message)));
                      }
                    },
                  ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    final thread = _thread;
    final file = _file;
    if ((text.isEmpty && file == null) || thread == null || _sending) return;
    if (replyBlockReason(canReply: thread.canReply, canIntervene: thread.canIntervene, windowOpen: thread.windowOpen, ownerName: thread.ownerName) != null) {
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.postJson(
        '$_path/messages',
        replyBody(
          text,
          mediaUrl: file == null ? null : 'data:${file.mime};base64,${base64Encode(file.bytes)}',
          fileName: file?.name,
          buttons: quickReplyButtons(_buttons),
        ),
      );
      final row = body['message'];
      if (!mounted) return;
      setState(() {
        _input.clear();
        _file = null;
        _buttons = const [];
        if (row is Map) {
          _thread = thread.copyWith(messages: [...thread.messages, ChatMessage.fromJson(Map<String, dynamic>.from(row))]);
        }
      });
      _jumpToEnd();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
      if (error.code == 'WINDOW_CLOSED' || error.code == 'NOT_OWNER' || error.code == 'INTERVENE_REQUIRED') {
        await _load();
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickFile({required bool image}) async {
    final file = await FilePicker.pickFile(
      type: image ? FileType.image : FileType.custom,
      allowedExtensions: image ? null : const ['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx'],
    );
    if (file == null) return;
    final bytes = await file.readAsBytes();
    final mime = mimeForFileName(file.name);
    final reason = mediaRejectReason(mime: mime, bytes: bytes.length);
    if (!mounted) return;
    if (reason != null) {
      setState(() => _error = reason);
      return;
    }
    setState(() {
      _file = (name: file.name, mime: mime, bytes: bytes);
      _error = null;
    });
  }

  Future<void> _editButtons() async {
    final fields = List.generate(3, (index) => TextEditingController(text: index < _buttons.length ? _buttons[index] : ''));
    final saved = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Reply buttons'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Up to three buttons. The customer taps one and that text comes back as their reply.'),
            const SizedBox(height: 12),
            for (final field in fields) ...[
              TextField(controller: field, decoration: const InputDecoration(labelText: 'Button')),
              const SizedBox(height: 8),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Use')),
        ],
      ),
    );
    final titles = fields.map((field) => field.text.trim()).where((text) => text.isNotEmpty).toList();
    for (final field in fields) {
      field.dispose();
    }
    if (saved == true && mounted) setState(() => _buttons = titles);
  }

  @override
  Widget build(BuildContext context) {
    final thread = _thread;
    final block = thread == null
        ? null
        : replyBlockReason(
            canReply: thread.canReply,
            canIntervene: thread.canIntervene,
            windowOpen: thread.windowOpen,
            ownerName: thread.ownerName,
          );
    return Scaffold(
      backgroundColor: const Color(0xFFEFEAE2),
      appBar: AppBar(
        backgroundColor: const Color(0xFF008069),
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: Colors.white)),
            if ((widget.subtitle ?? '').isNotEmpty)
              Text(widget.subtitle!, style: const TextStyle(fontSize: 13, color: Color(0xCCFFFFFF))),
          ],
        ),
        actions: [
          IconButton(tooltip: 'Tags', onPressed: _tags, icon: const Icon(Icons.label_outline)),
        ],
      ),
      body: Column(
        children: [
          if (thread != null && !thread.isGroup && thread.inboxState != null) _ownershipBar(thread),
          Expanded(child: _messages(thread)),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(_error!, style: const TextStyle(color: Color(0xFFB91C1C))),
            ),
          if (block != null && (thread == null || thread.canReply || !thread.windowOpen))
            Container(
              width: double.infinity,
              color: const Color(0xFFF0F2F5),
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
              child: Text(block, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: Color(0xFF3B4A54))),
            ),
          ColoredBox(
            color: const Color(0xFFF0F2F5),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_file != null || _buttons.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          children: [
                            if (_file != null)
                              InputChip(
                                label: Text(_file!.name, overflow: TextOverflow.ellipsis),
                                onDeleted: _sending ? null : () => setState(() => _file = null),
                              ),
                            if (_buttons.isNotEmpty) ...[
                              const SizedBox(width: 6),
                              InputChip(
                                label: Text('${_buttons.length} button${_buttons.length == 1 ? '' : 's'}'),
                                onDeleted: _sending ? null : () => setState(() => _buttons = const []),
                              ),
                            ],
                          ],
                        ),
                      ),
                    if (matchingSavedReplies(_input.text, _replies).isNotEmpty)
                      Material(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        child: Column(
                          children: [
                            for (final reply in matchingSavedReplies(_input.text, _replies))
                              ListTile(
                                dense: true,
                                title: Text(reply['title']?.toString() ?? 'Reply'),
                                subtitle: Text('/${reply['shortcut'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis),
                                onTap: () => _applyReply(reply),
                              ),
                          ],
                        ),
                      ),
                    Row(
                      children: [
                        PopupMenuButton<String>(
                          tooltip: 'Attach',
                          enabled: block == null && !_sending,
                          icon: const Icon(Icons.attach_file, color: Color(0xFF008069)),
                          onSelected: (kind) => _pickFile(image: kind == 'photo'),
                          itemBuilder: (context) => const [
                            PopupMenuItem(value: 'photo', child: Text('Photo')),
                            PopupMenuItem(value: 'file', child: Text('Document')),
                          ],
                        ),
                        IconButton(
                          tooltip: 'Reply buttons',
                          onPressed: block != null || _sending ? null : _editButtons,
                          icon: const Icon(Icons.smart_button_outlined, color: Color(0xFF008069)),
                        ),
                        IconButton(
                          tooltip: 'Saved replies',
                          onPressed: block != null || _sending ? null : _openReplies,
                          icon: const Icon(Icons.bookmark_border, color: Color(0xFF008069)),
                        ),
                        Expanded(
                          child: TextField(
                            controller: _input,
                            enabled: block == null && !_sending,
                            minLines: 1,
                            maxLines: 4,
                            textInputAction: TextInputAction.send,
                            decoration: InputDecoration(
                              hintText: 'Message or / for saved replies',
                              filled: true,
                              fillColor: Colors.white,
                              isDense: true,
                              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                            ),
                            onChanged: (value) {
                              if (value.trimLeft().startsWith('/')) _ensureReplies();
                              setState(() {});
                            },
                            onSubmitted: (_) => _send(),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Material(
                          color: block != null || _sending ? const Color(0xFF008069).withValues(alpha: 0.45) : const Color(0xFF008069),
                          shape: const CircleBorder(),
                          child: IconButton(onPressed: block != null || _sending ? null : _send, color: Colors.white, icon: const Icon(Icons.send)),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _ownershipBar(ChatThread thread) {
    final mine = thread.assignedTo != null && thread.assignedTo == widget.session.user['id']?.toString();
    final state = thread.inboxState;
    final colors = switch (state) {
      'requesting' => (bg: const Color(0xFFFEF3C7), fg: const Color(0xFF92400E)),
      'intervened' => (bg: const Color(0xFFDBEAFE), fg: const Color(0xFF1E40AF)),
      _ => (bg: const Color(0xFFF3F4F6), fg: const Color(0xFF374151)),
    };
    final label = switch (state) {
      'requesting' => 'Requesting',
      'intervened' => 'Intervened',
      _ => 'Active',
    };
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: colors.bg, borderRadius: BorderRadius.circular(12)),
                child: Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: colors.fg)),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  ownershipCaption(inboxState: state, mine: mine, ownerName: thread.ownerName),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 13, color: Color(0xFF3B4A54)),
                ),
              ),
            ],
          ),
          if (thread.canIntervene || thread.canTakeOver || thread.canResolve || thread.canTransfer) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                if (thread.canIntervene)
                  FilledButton(
                    onPressed: _sending ? null : () => _ownership('intervene'),
                    style: FilledButton.styleFrom(backgroundColor: const Color(0xFF008069), visualDensity: VisualDensity.compact),
                    child: const Text('Intervene'),
                  ),
                if (thread.canTakeOver)
                  OutlinedButton(onPressed: _sending ? null : () => _ownership('take_over'), child: const Text('Take over')),
                if (thread.canTransfer)
                  OutlinedButton(onPressed: _sending ? null : _transfer, child: const Text('Transfer')),
                if (thread.canResolve)
                  FilledButton(
                    onPressed: _sending ? null : () => _ownership('resolve'),
                    style: FilledButton.styleFrom(backgroundColor: const Color(0xFF008069), visualDensity: VisualDensity.compact),
                    child: const Text('Resolve'),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  bool _fileRow(ChatMessage message) {
    final url = message.mediaUrl ?? '';
    return url.isNotEmpty && message.type != 'image' && message.type != 'sticker';
  }

  bool _mediaCaption(ChatMessage message) {
    if ((message.mediaUrl ?? '').isEmpty) return false;
    return const {'Photo', 'Document', 'Video', 'Voice message', 'Sticker'}.contains(message.text);
  }

  Widget _media(ChatMessage message) {
    final url = message.mediaUrl ?? '';
    if (message.type == 'image' || message.type == 'sticker') {
      return Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(6),
          child: _AuthedImage(api: widget.session.api, url: url),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.insert_drive_file_outlined, size: 18, color: Color(0xFF008069)),
          const SizedBox(width: 6),
          Flexible(child: Text(message.text.isEmpty ? 'Document' : message.text, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }

  Widget _messages(ChatThread? thread) {
    if (_loading && thread == null) return const Center(child: Text('Loading...'));
    if (thread == null) return const SizedBox.shrink();
    if (thread.messages.isEmpty) return const Center(child: Text('No messages yet'));
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      itemCount: thread.messages.length + (thread.hasMore ? 1 : 0),
      itemBuilder: (context, index) {
        if (thread.hasMore && index == 0) {
          return TextButton(
            onPressed: _loading ? null : () => _load(beforeCreatedAt: thread.oldestCreatedAt, beforeMessageId: thread.oldestMessageId),
            child: const Text('Earlier messages'),
          );
        }
        final message = thread.messages[thread.hasMore ? index - 1 : index];
        final outgoing = message.outgoing;
        return Align(
          alignment: outgoing ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            margin: const EdgeInsets.symmetric(vertical: 2),
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
            decoration: BoxDecoration(
              color: outgoing ? const Color(0xFFD9FDD3) : Colors.white,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(outgoing ? 8 : 0),
                topRight: Radius.circular(outgoing ? 0 : 8),
                bottomLeft: const Radius.circular(8),
                bottomRight: const Radius.circular(8),
              ),
              boxShadow: const [BoxShadow(color: Color(0x14000000), blurRadius: 1, offset: Offset(0, 1))],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!outgoing && (message.senderName ?? '').isNotEmpty)
                  Text(message.senderName!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: Color(0xFF06CF9C))),
                if ((message.mediaUrl ?? '').isNotEmpty) _media(message),
                if (message.text.isNotEmpty && !_mediaCaption(message) && !_fileRow(message))
                  Text(message.text, style: const TextStyle(fontSize: 14, height: 1.35, color: Color(0xFF111B21))),
                for (final title in message.buttonTitles)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(top: 4),
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    decoration: BoxDecoration(
                      border: Border.all(color: const Color(0xFF008069)),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(title, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFF008069), fontWeight: FontWeight.w600)),
                  ),
                const SizedBox(height: 2),
                Align(
                  alignment: Alignment.centerRight,
                  child: Text(chatClock(message.createdAt), style: const TextStyle(fontSize: 11, color: Color(0xFF667781))),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _AuthedImage extends StatefulWidget {
  const _AuthedImage({required this.api, required this.url});

  final KhatarioApi api;
  final String url;

  @override
  State<_AuthedImage> createState() => _AuthedImageState();
}

class _AuthedImageState extends State<_AuthedImage> {
  Uint8List? _bytes;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final url = widget.url;
      if (url.startsWith('data:')) {
        final comma = url.indexOf(',');
        if (comma < 0) throw StateError('bad data url');
        if (!mounted) return;
        setState(() => _bytes = base64Decode(url.substring(comma + 1)));
        return;
      }
      final response = await widget.api.dio.get<List<int>>(url, options: Options(responseType: ResponseType.bytes));
      final data = response.data;
      if (!mounted || data == null) return;
      setState(() => _bytes = Uint8List.fromList(data));
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_failed) return const Text('Photo', style: TextStyle(fontSize: 13, color: Color(0xFF667781)));
    if (_bytes == null) return const SizedBox(width: 160, height: 80, child: Center(child: CircularProgressIndicator(strokeWidth: 2)));
    return Image.memory(_bytes!, width: 220, fit: BoxFit.cover);
  }
}
