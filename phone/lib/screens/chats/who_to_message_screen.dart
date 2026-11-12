import 'dart:async';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../capability.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import 'audience_logic.dart';
import 'campaigns_logic.dart';
import 'send_message_screen.dart';

/// Website `/whatsapp/who-to-message`: pick a list (not bought lately, top buyers, bought once, store
/// enquiry, WhatsApp message), tick the people, choose a saved reply and Continue. Nothing is sent
/// here: Continue opens Send message on the campaign tab, where the campaign is reviewed first.
class WhoToMessageScreen extends StatefulWidget {
  const WhoToMessageScreen({super.key, required this.session, this.capabilities});

  final AppSession session;
  final Capabilities? capabilities;

  @override
  State<WhoToMessageScreen> createState() => _WhoToMessageScreenState();
}

class _WhoToMessageScreenState extends State<WhoToMessageScreen> {
  final _days = TextEditingController(text: '30');
  final _period = TextEditingController(text: '30');
  final _limit = TextEditingController(text: '10');
  Timer? _debounce;
  int _seq = 0;

  String _condition = 'quiet';
  List<WhoPerson> _people = const [];
  final Set<String> _selected = {};
  List<SavedReply> _replies = const [];
  String _replyId = '';
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  String? _rangeError;

  int _n(TextEditingController c) => int.tryParse(c.text.trim()) ?? 0;

  WhoCondition get _cond => whoConditions.firstWhere((c) => c.id == _condition);

  @override
  void initState() {
    super.initState();
    _load();
    // Saved replies are optional: without them the message is written on the next screen.
    widget.session.api.getJson(savedRepliesPath).then((b) {
      if (mounted) setState(() => _replies = savedRepliesFrom(b));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in [_days, _period, _limit]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    final problem = whoRangeError(_condition, days: _n(_days), periodDays: _n(_period), limit: _n(_limit));
    if (problem != null) {
      setState(() => _rangeError = problem);
      return;
    }
    final seq = ++_seq;
    setState(() {
      _rangeError = null;
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson(whoToMessagePath(_condition, days: _n(_days), periodDays: _n(_period), limit: _n(_limit)));
      if (!mounted || seq != _seq) return;
      setState(() {
        _people = peopleFrom(body);
        _selected.clear();
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _people = const [];
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _people = const [];
        _error = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  void _setCondition(String id) {
    if (id == _condition) return;
    _condition = id;
    _load();
  }

  void _setNumber(TextEditingController c, int n) {
    c.text = '$n';
    _load();
  }

  void _typed() {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      if (mounted) _load();
    });
  }

  void _toggle(WhoPerson p) => setState(() {
        if (!_selected.remove(p.phone)) _selected.add(p.phone);
      });

  bool get _all => _people.isNotEmpty && _people.every((p) => _selected.contains(p.phone));

  void _continue() {
    final chosen = _people.where((p) => _selected.contains(p.phone)).toList();
    final reply = _replies.where((r) => r.id == _replyId).firstOrNull;
    final draft = SendDraft(recipients: whoPeopleToRecipients(chosen), text: reply?.message ?? '', campaignName: _cond.label);
    Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => SendMessageScreen(session: widget.session, draft: draft, capabilities: widget.capabilities)));
  }

  @override
  Widget build(BuildContext context) {
    final n = _selected.length;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const KBackBar('Who to message'),
          Expanded(child: _body()),
        ]),
      ),
      bottomNavigationBar: n == 0 || _loading || _error != null
          ? null
          : KBottomBar(children: [Expanded(child: KButton(label: 'Continue with $n ${n == 1 ? 'person' : 'people'}', onPressed: _continue))]),
    );
  }

  Widget _options() {
    final days = _condition == 'quiet' || _condition == 'enquiry' || _condition == 'whatsapp';
    final isDaysError = _rangeError != null && _rangeError!.startsWith('Days');
    if (_condition == 'once') return Text('Everyone with exactly one posted bill.', style: AppText.caption);
    if (days) {
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        KChipBar<int>(
          value: _n(_days),
          padding: EdgeInsets.zero,
          options: const [(15, '15 days'), (30, '30 days'), (60, '60 days')],
          onChanged: (v) => _setNumber(_days, v),
        ),
        const SizedBox(height: AppSpace.sm),
        KTextField(label: 'Days', controller: _days, keyboard: TextInputType.number, error: isDaysError ? _rangeError : null, onChanged: (_) => _typed()),
      ]);
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      KChipBar<int>(
        value: _n(_period),
        padding: EdgeInsets.zero,
        options: const [(30, '30d'), (90, '90d'), (365, '365d')],
        onChanged: (v) => _setNumber(_period, v),
      ),
      const SizedBox(height: AppSpace.sm),
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: KTextField(label: 'Last (days)', controller: _period, keyboard: TextInputType.number, error: isDaysError ? _rangeError : null, onChanged: (_) => _typed())),
        const SizedBox(width: AppSpace.sm),
        Expanded(
          child: KTextField(label: 'Show', controller: _limit, keyboard: TextInputType.number, error: _rangeError != null && !isDaysError ? _rangeError : null, onChanged: (_) => _typed()),
        ),
      ]),
    ]);
  }

  Widget _body() {
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl * 3),
      children: [
        Text('Pick a list, tick the people, choose a saved reply, then review the campaign before anything is sent.', style: AppText.caption),
        const SizedBox(height: AppSpace.md),
        KChipBar<String>(value: _condition, padding: EdgeInsets.zero, options: [for (final c in whoConditions) (c.id, c.label)], onChanged: _setCondition),
        const SizedBox(height: AppSpace.md),
        Text(_cond.hint, style: AppText.bodyStrong),
        const SizedBox(height: AppSpace.sm),
        _options(),
        const SizedBox(height: AppSpace.lg),
        ..._list(),
      ],
    );
  }

  List<Widget> _list() {
    if (_loading) return const [KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2))];
    if (_error != null) {
      return [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load this list',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ];
    }
    if (_rangeError != null) return const [];
    if (_people.isEmpty) {
      return const [
        KEmptyState(
          icon: LucideIcons.users,
          title: 'Nobody on this list',
          body: 'No one matches. People without a phone, people who opted out, and anyone already in a campaign this week are left off.',
        ),
      ];
    }
    return [
      Row(children: [
        Expanded(child: Text('${_people.length} ${_people.length == 1 ? 'person' : 'people'}', style: AppText.bodyStrong)),
        KTextButton(
          label: _all ? 'Clear selection' : 'Select everyone',
          onTap: () => setState(() {
            if (_all) {
              _selected.clear();
            } else {
              _selected.addAll(_people.map((p) => p.phone));
            }
          }),
        ),
      ]),
      const SizedBox(height: AppSpace.sm),
      KCard(
        child: KDivided(children: [
          for (final p in _people)
            KListRow(
              title: p.name,
              subtitle: [Contact(id: '', phone: p.phone).phoneText, if (p.reason.isNotEmpty) p.reason].join(' · '),
              leading: KAvatar(name: p.name),
              trailing: Icon(_selected.contains(p.phone) ? LucideIcons.squareCheck : LucideIcons.square, size: 22, color: _selected.contains(p.phone) ? AppColors.brand : AppColors.ink3),
              onTap: () => _toggle(p),
            ),
        ]),
      ),
      const SizedBox(height: AppSpace.lg),
      KPickField<String>(
        label: 'Saved reply',
        value: _replyId,
        options: [('', 'Write the message on the next screen'), for (final r in _replies) (r.id, r.title)],
        onChanged: (v) => setState(() => _replyId = v),
      ),
    ];
  }
}
