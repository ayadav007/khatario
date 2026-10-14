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

  Future<void> _ownership(String action) async {
    setState(() => _sending = true);
    try {
      await widget.session.api.postJson('$_path/ownership', {'action': action});
      if (!mounted) return;
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    final thread = _thread;
    if (text.isEmpty || thread == null || _sending) return;
    if (replyBlockReason(canReply: thread.canReply, canIntervene: thread.canIntervene, windowOpen: thread.windowOpen, ownerName: thread.ownerName) != null) {
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.postJson('$_path/messages', replyBody(text));
      final row = body['message'];
      if (!mounted) return;
      setState(() {
        _input.clear();
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
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _input,
                        enabled: block == null && !_sending,
                        minLines: 1,
                        maxLines: 4,
                        textInputAction: TextInputAction.send,
                        decoration: InputDecoration(
                          hintText: 'Message',
                          filled: true,
                          fillColor: Colors.white,
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                        ),
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
          if (thread.canIntervene || thread.canTakeOver || thread.canResolve) ...[
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
                Text(message.text, style: const TextStyle(fontSize: 14, height: 1.35, color: Color(0xFF111B21))),
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
