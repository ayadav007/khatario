import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import 'chat_thread_logic.dart';

/// Broadcasts: the website campaign list, started from the Chats menu.
class BroadcastsScreen extends StatefulWidget {
  const BroadcastsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BroadcastsScreen> createState() => _BroadcastsScreenState();
}

class _BroadcastsScreenState extends State<BroadcastsScreen> {
  List<Map<String, dynamic>> _rows = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/campaigns?limit=50');
      final raw = body['campaigns'];
      if (!mounted) return;
      setState(() {
        _rows = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    }
  }

  Future<void> _act(String id, String action) async {
    try {
      await widget.session.api.patchJson('/api/whatsapp/campaigns/$id', {'action': action});
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: KFab(
        icon: LucideIcons.megaphone,
        label: 'New',
        onTap: () async {
          final sent = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _NewBroadcastScreen(session: widget.session)));
          if (sent == true) _load();
        },
      ),
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Broadcasts'),
            Expanded(
              child: _loading
                  ? const KSpinner()
                  : _error != null && _rows.isEmpty
                      ? Center(child: Text(_error!))
                      : _rows.isEmpty
                          ? const Center(child: Text('No broadcasts yet'))
                          : ListView.separated(
                              itemCount: _rows.length,
                              separatorBuilder: (_, _) => const Divider(height: 1, color: AppColors.hairline),
                              itemBuilder: (context, index) {
                                final row = _rows[index];
                                final status = row['status']?.toString() ?? '';
                                final id = row['id']?.toString() ?? '';
                                return KListRow(
                                  title: row['name']?.toString() ?? 'Broadcast',
                                  subtitle: '$status · ${row['sent_count'] ?? 0}/${row['total_recipients'] ?? 0} sent',
                                  trailing: status == 'running'
                                      ? KTextButton(label: 'Pause', onTap: () => _act(id, 'pause'))
                                      : status == 'draft' || status == 'paused'
                                          ? KTextButton(label: 'Start', onTap: () => _act(id, status == 'paused' ? 'resume' : 'start'))
                                          : null,
                                );
                              },
                            ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NewBroadcastScreen extends StatefulWidget {
  const _NewBroadcastScreen({required this.session});

  final AppSession session;

  @override
  State<_NewBroadcastScreen> createState() => _NewBroadcastScreenState();
}

class _NewBroadcastScreenState extends State<_NewBroadcastScreen> {
  final _name = TextEditingController();
  final _message = TextEditingController();
  final _extra = TextEditingController();
  final _buttons = List.generate(3, (_) => TextEditingController());
  List<Map<String, dynamic>> _contacts = const [];
  final _picked = <String>{};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _message.dispose();
    _extra.dispose();
    for (final field in _buttons) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/contacts?limit=100');
      final raw = body['contacts'];
      if (!mounted) return;
      setState(() {
        _contacts = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    }
  }

  List<Map<String, String>> _recipients() {
    final people = <Map<String, String>>[];
    for (final contact in _contacts) {
      final phone = contact['phone']?.toString().replaceAll(RegExp(r'\D'), '') ?? '';
      if (!_picked.contains(contact['id']?.toString()) || phone.length < 9) continue;
      people.add({'phone': phone, 'name': contact['name']?.toString() ?? ''});
    }
    for (final line in _extra.text.split(RegExp(r'[\s,]+'))) {
      final phone = line.replaceAll(RegExp(r'\D'), '');
      if (phone.length < 9 || phone.length > 15) continue;
      people.add({'phone': phone, 'name': ''});
    }
    return people;
  }

  Future<void> _send() async {
    final recipients = _recipients();
    if (_name.text.trim().isEmpty || _message.text.trim().isEmpty || recipients.isEmpty) {
      setState(() => _error = 'Add a name, a message, and at least one phone number.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final buttons = quickReplyButtons(_buttons.map((field) => field.text).toList());
      await widget.session.api.postJson('/api/whatsapp/campaigns', {
        'name': _name.text.trim(),
        'message_type': buttons.isEmpty ? 'text' : 'button',
        'message_text': _message.text.trim(),
        if (buttons.isNotEmpty) 'buttons': buttons,
        'recipients': recipients,
      });
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('New broadcast'),
            Expanded(
              child: _loading
                  ? const KSpinner()
                  : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                KTextField(label: 'Name', controller: _name),
                const SizedBox(height: 12),
                KTextField(label: 'Message', controller: _message, maxLines: 6),
                const SizedBox(height: 12),
                const Text('Buttons (optional)', style: TextStyle(fontWeight: FontWeight.w600)),
                for (var i = 0; i < _buttons.length; i++) KTextField(label: 'Button ${i + 1}', controller: _buttons[i]),
                const SizedBox(height: 12),
                KTextField(label: 'Extra numbers', controller: _extra, hint: 'One number per line', maxLines: 4),
                const SizedBox(height: 12),
                const Text('Contacts', style: TextStyle(fontWeight: FontWeight.w600)),
                if (_contacts.isEmpty) const Text('No saved contacts. Type numbers above.'),
                for (final contact in _contacts)
                  CheckboxListTile(
                    value: _picked.contains(contact['id']?.toString()),
                    title: Text(contact['name']?.toString().isNotEmpty == true ? contact['name'].toString() : contact['phone']?.toString() ?? ''),
                    subtitle: Text(contact['phone']?.toString() ?? ''),
                    controlAffinity: ListTileControlAffinity.leading,
                    onChanged: (on) {
                      final id = contact['id']?.toString();
                      if (id == null) return;
                      setState(() {
                        if (on == true) {
                          _picked.add(id);
                        } else {
                          _picked.remove(id);
                        }
                      });
                    },
                  ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
                ],
                const SizedBox(height: 16),
                KButton(label: _saving ? 'Sending…' : 'Send broadcast', onPressed: _saving ? null : _send),
              ],
            ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Keyword bot replies. Buttons on a rule are the same quick replies AiSensy sends from a bot.
class BotRepliesScreen extends StatefulWidget {
  const BotRepliesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<BotRepliesScreen> createState() => _BotRepliesScreenState();
}

class _BotRepliesScreenState extends State<BotRepliesScreen> {
  List<Map<String, dynamic>> _rules = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/bot-rules');
      final raw = body['rules'];
      if (!mounted) return;
      setState(() {
        _rules = raw is List ? raw.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList() : const [];
        _loading = false;
      });
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _loading = false;
      });
    }
  }

  Future<void> _toggle(Map<String, dynamic> rule, bool active) async {
    final id = rule['id']?.toString();
    if (id == null) return;
    try {
      await widget.session.api.patchJson('/api/whatsapp/bot-rules/$id', {'is_active': active});
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      floatingActionButton: KFab(
        label: 'Rule',
        onTap: () async {
          final saved = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => _NewBotRuleScreen(session: widget.session)));
          if (saved == true) _load();
        },
      ),
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Bot replies'),
            Expanded(
              child: _loading
                  ? const KSpinner()
                  : _error != null && _rules.isEmpty
                      ? Center(child: Text(_error!))
                      : _rules.isEmpty
                          ? const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('No bot replies yet. A rule answers when a customer message contains the keyword.', textAlign: TextAlign.center)))
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, 96),
                              itemCount: _rules.length,
                              separatorBuilder: (_, _) => const SizedBox(height: AppSpace.sm),
                              itemBuilder: (context, index) {
                                final rule = _rules[index];
                                final active = rule['is_active'] == true;
                                return KToggleField(
                                  label: rule['name']?.toString() ?? 'Rule',
                                  help: 'When they say “${rule['trigger_value'] ?? ''}”',
                                  value: active,
                                  onChanged: (on) => _toggle(rule, on),
                                );
                              },
                            ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NewBotRuleScreen extends StatefulWidget {
  const _NewBotRuleScreen({required this.session});

  final AppSession session;

  @override
  State<_NewBotRuleScreen> createState() => _NewBotRuleScreenState();
}

class _NewBotRuleScreenState extends State<_NewBotRuleScreen> {
  final _name = TextEditingController();
  final _keyword = TextEditingController();
  final _message = TextEditingController();
  final _buttons = List.generate(3, (_) => TextEditingController());
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _keyword.dispose();
    _message.dispose();
    for (final field in _buttons) {
      field.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty || _keyword.text.trim().isEmpty || _message.text.trim().isEmpty) {
      setState(() => _error = 'Name, keyword, and reply are required.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final buttons = quickReplyButtons(_buttons.map((field) => field.text).toList());
      await widget.session.api.postJson('/api/whatsapp/bot-rules', {
        'name': _name.text.trim(),
        'trigger_type': 'keyword',
        'trigger_value': _keyword.text.trim(),
        'response_type': buttons.isEmpty ? 'text' : 'button',
        'response_message': _message.text.trim(),
        if (buttons.isNotEmpty) 'response_options': buttons,
      });
      if (!mounted) return;
      Navigator.pop(context, true);
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.message;
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('New bot reply'),
            Expanded(
              child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          KTextField(label: 'Name', controller: _name),
          const SizedBox(height: 12),
          KTextField(label: 'Keyword', controller: _keyword, hint: 'price'),
          const SizedBox(height: 12),
          KTextField(label: 'Reply', controller: _message, maxLines: 6),
          const SizedBox(height: 12),
          const Text('Buttons (optional)', style: TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Text('The customer sees these under the reply and can tap one.', style: AppText.caption),
          for (var i = 0; i < _buttons.length; i++) KTextField(label: 'Button ${i + 1}', controller: _buttons[i]),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
          ],
          const SizedBox(height: 16),
          KButton(label: _saving ? 'Saving…' : 'Save rule', onPressed: _saving ? null : _save),
        ],
      ),
            ),
          ],
        ),
      ),
    );
  }
}
