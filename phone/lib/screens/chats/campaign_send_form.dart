import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import 'audience_logic.dart';
import 'campaigns_logic.dart';
import 'contact_picker.dart';
import 'send_message_parts.dart';

/// The "Bulk campaign" half of Send message (website `CampaignSendTab`): name, message, who gets
/// it, sending speed and when. Asks first with the recipient count, then posts once.
class CampaignSendForm extends StatefulWidget {
  const CampaignSendForm({super.key, required this.session, this.draft, this.clock});

  final AppSession session;

  /// People, a saved reply and a name handed in from Who to message.
  final SendDraft? draft;

  /// The current time, for the schedule. Tests give a fixed one.
  final DateTime? clock;

  @override
  State<CampaignSendForm> createState() => _CampaignSendFormState();
}

class _CampaignSendFormState extends State<CampaignSendForm> {
  final _name = TextEditingController();
  final _message = TextEditingController();
  final _paste = TextEditingController();
  final _buttons = ButtonsController();
  final _delay = TextEditingController(text: '2');
  final _jitter = TextEditingController(text: '2');
  final _batch = TextEditingController(text: '20');
  final _pause = TextEditingController(text: '120');
  final _daily = TextEditingController();

  MessageKind _kind = MessageKind.text;
  MediaItem? _picture;
  List<Recipient> _picked = const [];
  int _optedOut = 0;
  bool _connected = true;
  bool _schedule = false;
  DateTime? _day;
  int? _slot;
  bool _busy = false;
  bool _loadingPick = false;

  @override
  void initState() {
    super.initState();
    final d = widget.draft;
    if (d != null) {
      _name.text = d.campaignName;
      _message.text = d.text;
      _picked = _dedupe(d.recipients);
      _checkOptOuts();
    }
    widget.session.api.getJson(whatsappStatusPath).then((s) {
      if (mounted) setState(() => _connected = whatsappConnected(s));
    }).catchError((_) {});
  }

  @override
  void dispose() {
    for (final f in [_name, _message, _paste, _delay, _jitter, _batch, _pause, _daily]) {
      f.dispose();
    }
    _buttons.dispose();
    super.dispose();
  }

  static List<Recipient> _dedupe(Iterable<Recipient> all) {
    final seen = <String>{};
    return [for (final r in all) if (seen.add(r.phone)) r];
  }

  List<Recipient> get _recipients => _dedupe([..._picked, ...parseRecipients(_paste.text)]);

  int get _skippedLines {
    final lines = _paste.text.split('\n').where((l) => l.trim().isNotEmpty).length;
    return lines - parseRecipients(_paste.text).length;
  }

  AntiBan get _antiBan => AntiBan.parse(delay: _delay.text, jitter: _jitter.text, batch: _batch.text, pause: _pause.text, daily: _daily.text);

  DateTime? get _when => combineSchedule(_day, _slot);

  DateTime get _now => widget.clock ?? DateTime.now();

  void _add(List<Recipient> more) {
    setState(() => _picked = _dedupe([..._picked, ...more]));
    _checkOptOuts();
  }

  /// The website warns about opted-out numbers among the chosen contacts. The server leaves them
  /// out either way, so a failed or oversized check just shows no warning.
  Future<void> _checkOptOuts() async {
    final phones = _picked.map((r) => r.phone).toList();
    if (phones.isEmpty || phones.length > 150) {
      if (mounted) setState(() => _optedOut = 0);
      return;
    }
    try {
      final reply = await widget.session.api.getJson(checkUnsubscribesPath(phones));
      final list = reply['unsubscribed'];
      if (mounted) setState(() => _optedOut = list is List ? list.length : 0);
    } catch (_) {
      if (mounted) setState(() => _optedOut = 0);
    }
  }

  Future<void> _fromContacts() async {
    final picked = await Navigator.of(context).push<List<Contact>>(
      MaterialPageRoute(builder: (_) => ContactPickerScreen(session: widget.session, confirmLabel: (n) => 'Use $n ${n == 1 ? 'contact' : 'contacts'}')),
    );
    if (picked == null || picked.isEmpty || !mounted) return;
    _add([
      for (final c in picked)
        if (isValidPhone(c.phone)) Recipient(phone: normalizePhone(c.phone), name: c.name),
    ]);
  }

  Future<void> _fromGroups() async {
    if (_loadingPick) return;
    final groups = await Navigator.of(context).push<List<ContactGroup>>(MaterialPageRoute(builder: (_) => GroupPickerScreen(session: widget.session)));
    if (groups == null || groups.isEmpty || !mounted) return;
    setState(() => _loadingPick = true);
    final people = <Recipient>[];
    final failed = <String>[];
    for (final g in groups) {
      try {
        for (final m in membersFrom(await widget.session.api.getJson(groupMembersPath(g.id)))) {
          if (isValidPhone(m.phone)) people.add(Recipient(phone: normalizePhone(m.phone), name: m.name));
        }
      } catch (_) {
        failed.add(g.name);
      }
    }
    if (!mounted) return;
    setState(() => _loadingPick = false);
    if (failed.isNotEmpty) showKToast(context, 'Could not load the contacts of ${failed.join(', ')}', tone: KTone.negative);
    _add(people);
  }

  void _clearPicked() {
    setState(() {
      _picked = const [];
      _optedOut = 0;
    });
  }

  Future<void> _submit() async {
    if (_busy) return;
    final image = _kind == MessageKind.image;
    final buttons = _kind == MessageKind.buttons ? _buttons.value : null;
    final recipients = _recipients;
    final when = _schedule ? _when : null;
    final antiBan = _antiBan;
    final problem = campaignError(name: _name.text, text: _message.text, buttons: buttons, recipients: recipients, image: image, mediaUrl: _picture?.url) ??
        buttons?.ctaError ??
        antiBanError(antiBan) ??
        (_schedule ? scheduleError(when, now: _now) : null);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final ask = campaignSendAsk(name: _name.text.trim(), text: _message.text, count: recipients.length, scheduledAt: when);
    final sure = await askSheet(context, title: ask.title, text: ask.text, confirmLabel: ask.confirm, cancelLabel: ask.cancel, danger: false);
    if (!sure || !mounted || _busy) return;
    setState(() => _busy = true);
    try {
      final reply = await widget.session.api.postJson(
        campaignsPath,
        campaignBody(name: _name.text, text: _message.text, buttons: buttons, recipients: recipients, antiBan: antiBan, scheduledAt: when, image: image, mediaUrl: _picture?.url),
      );
      if (!mounted) return;
      showKToast(context, campaignCreatedText(reply, scheduled: when != null), tone: KTone.positive);
      Navigator.of(context).maybePop(true);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not create the campaign. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    final count = _recipients.length;
    final antiBan = _antiBan;
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl * 3),
      children: [
        if (!_connected) ...[
          KCard(
            padding: const EdgeInsets.all(AppSpace.lg),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('WhatsApp is not connected', style: AppText.bodyStrong),
              const SizedBox(height: AppSpace.xs),
              Text('You can create campaigns, but they cannot be started until WhatsApp is connected. Connect it from Settings.', style: AppText.caption),
              const SizedBox(height: AppSpace.md),
              KButton.secondary(label: 'Connect WhatsApp', expand: false, onPressed: () => openWebsiteInApp(context, widget.session, '/settings?tab=whatsapp', 'WhatsApp')),
            ]),
          ),
          const SizedBox(height: AppSpace.md),
        ],
        KTextField(label: 'Campaign name', controller: _name, hint: 'e.g. New Product Launch Campaign', maxLength: 120),
        const SizedBox(height: AppSpace.md),
        KSegmented<MessageKind>(value: _kind, options: messageKindOptions, onChanged: (v) => setState(() => _kind = v)),
        const SizedBox(height: AppSpace.md),
        KTextField(
          label: _kind == MessageKind.image ? 'Caption' : 'Message',
          controller: _message,
          hint: _kind == MessageKind.image ? 'Enter caption for the image...' : 'Enter your message...',
          maxLines: 6,
          minLines: 3,
        ),
        if (_kind != MessageKind.text) ...[
          const SizedBox(height: AppSpace.md),
          if (_kind == MessageKind.buttons) Text('Add a picture to show above your buttons (optional).', style: AppText.caption),
          PictureField(session: widget.session, picture: _picture, onChanged: (m) => setState(() => _picture = m)),
        ],
        if (_kind == MessageKind.buttons) ...[const SizedBox(height: AppSpace.md), ButtonsEditor(controller: _buttons)],
        const SizedBox(height: AppSpace.lg),
        const KSectionHeader('Recipients'),
        KTextField(
          label: 'Phone numbers (one per line)',
          controller: _paste,
          hint: '919876543210\n9876543211, John Doe',
          maxLines: 6,
          minLines: 3,
          keyboard: TextInputType.multiline,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: AppSpace.sm),
        Text('Formats: 919876543210, +919876543210, 9876543210, phone,name', style: AppText.caption),
        const SizedBox(height: AppSpace.md),
        Row(children: [
          Expanded(child: KButton.secondary(label: 'Add from contacts', icon: LucideIcons.contact, onPressed: _fromContacts)),
          const SizedBox(width: AppSpace.sm),
          Expanded(child: KButton.secondary(label: 'Add from groups', icon: LucideIcons.users, loading: _loadingPick, onPressed: _loadingPick ? null : _fromGroups)),
        ]),
        const SizedBox(height: AppSpace.md),
        Row(children: [
          Expanded(child: Text(count == 1 ? '1 recipient' : '$count recipients', style: AppText.bodyStrong)),
          if (_picked.isNotEmpty) KTextButton(label: 'Clear chosen contacts', onTap: _clearPicked),
        ]),
        if (_skippedLines > 0) Text('$_skippedLines pasted ${_skippedLines == 1 ? 'line is' : 'lines are'} skipped: not a valid number, or a repeat.', style: AppText.caption),
        if (_optedOut > 0)
          Padding(
            padding: const EdgeInsets.only(top: AppSpace.xs),
            child: Text('$_optedOut of these numbers opted out and will be left out when sending.', style: AppText.caption.copyWith(color: AppColors.due)),
          ),
        const SizedBox(height: AppSpace.lg),
        const KSectionHeader('Anti-ban and sending controls'),
        Text('Sending too many messages too quickly can get a WhatsApp number banned. Start with slow settings.', style: AppText.caption),
        const SizedBox(height: AppSpace.md),
        KTextField(label: 'Delay between messages (seconds)', controller: _delay, keyboard: TextInputType.number, onChanged: (_) => setState(() {})),
        const SizedBox(height: AppSpace.md),
        KTextField(label: 'Random delay variation (± seconds)', controller: _jitter, keyboard: TextInputType.number, onChanged: (_) => setState(() {})),
        const SizedBox(height: AppSpace.md),
        KTextField(label: 'Batch size (messages per batch)', controller: _batch, keyboard: TextInputType.number, onChanged: (_) => setState(() {})),
        const SizedBox(height: AppSpace.md),
        KTextField(label: 'Pause between batches (seconds)', controller: _pause, keyboard: TextInputType.number, onChanged: (_) => setState(() {})),
        const SizedBox(height: AppSpace.md),
        KTextField(label: 'Daily send limit (optional)', controller: _daily, keyboard: TextInputType.number),
        if (count > 0 && antiBanError(antiBan) == null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpace.sm),
            child: Text('Estimated sending time: ${estimatedSendTime(antiBan, count)} for $count ${count == 1 ? 'recipient' : 'recipients'}', style: AppText.caption),
          ),
        const SizedBox(height: AppSpace.lg),
        KToggleField(label: 'Schedule for later', help: 'Off: it starts as soon as you create it.', value: _schedule, onChanged: (v) => setState(() => _schedule = v)),
        if (_schedule) ...[
          const SizedBox(height: AppSpace.md),
          KDateField(label: 'Date', value: _day, first: _now, last: _now.add(const Duration(days: 365)), onChanged: (d) => setState(() => _day = d)),
          const SizedBox(height: AppSpace.md),
          KPickField<int>(label: 'Time', value: _slot, options: scheduleSlots, onChanged: (v) => setState(() => _slot = v)),
        ],
        const SizedBox(height: AppSpace.lg),
        KButton(
          label: _schedule ? 'Schedule campaign' : 'Create campaign',
          icon: LucideIcons.send,
          loading: _busy,
          onPressed: _busy ? null : _submit,
        ),
      ],
    );
  }
}
