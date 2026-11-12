import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart' show ddMMMyyyyHm, jsNumberString;
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../hr/hr_manage_widgets.dart';
import '../hr/pay_widgets.dart';
import '../pages/website_page_screen.dart';
import '../reports/sales_reports.dart';
import '../sales/doc_action_sheets.dart';
import 'chat_thread_screen.dart';
import 'lead_pickers.dart';
import 'leads_logic.dart';

/// Website lead drawer on the phone: who and where from, stage and owner, deal value, comments,
/// reminders and the number's other enquiries, with Convert to customer and New enquiry.
/// Adding or finishing reminders, messaging a lead with no chat, and the close date stay on the website.
class LeadProfileScreen extends StatefulWidget {
  const LeadProfileScreen({super.key, required this.session, required this.leadId, this.isSupervisor = false});

  final AppSession session;
  final String leadId;

  /// Supervisors may delete anyone's comment; everyone else only their own.
  final bool isSupervisor;

  @override
  State<LeadProfileScreen> createState() => _LeadProfileScreenState();
}

class _LeadProfileScreenState extends State<LeadProfileScreen> with HrScreenState<LeadProfileScreen> {
  Lead? _lead;
  List<LeadNote> _notes = const [];
  LeadPickers _pickers = const LeadPickers();
  bool _notFound = false;
  final _comment = TextEditingController();
  final _value = TextEditingController();
  bool _valueEdited = false;

  String get _me => widget.session.user['id']?.toString() ?? '';

  @override
  void initState() {
    super.initState();
    _load();
    loadLeadPickers(widget.session).then((p) {
      if (mounted) setState(() => _pickers = p);
    });
  }

  @override
  void dispose() {
    _comment.dispose();
    _value.dispose();
    super.dispose();
  }

  Future<void> _fetch() async {
    final api = widget.session.api;
    try {
      final body = await api.getJson(leadPath(widget.leadId));
      final raw = body['lead'];
      if (!mounted) return;
      final lead = raw is Map ? Lead.fromJson(Map<String, dynamic>.from(raw)) : null;
      _notFound = lead == null;
      _lead = lead;
      if (lead != null) {
        _value.text = lead.dealValue == null ? '' : jsNumberString(lead.dealValue!);
        _valueEdited = false;
      }
    } on ApiException catch (e) {
      if (e.status != 404) rethrow;
      _notFound = true;
      _lead = null;
    }
    if (_lead == null) return;
    try {
      _notes = leadNotes(await api.getJson(leadNotesPath(widget.leadId)));
    } catch (_) {
      // Comments are secondary: the lead still opens without them.
    }
  }

  Future<void> _load() => guardedLoad(_fetch);

  /// After an action, whether or not it worked: the lead may already have changed elsewhere.
  Future<void> _reload() async {
    try {
      await _fetch();
    } catch (_) {
      // Keep what is on screen; the action's own message is already shown.
    }
    if (mounted) setState(() {});
  }

  void _openCustomer(String id) => reportOpenCustomer(context, widget.session, id);

  Future<void> _changeStage(String? stageId) async {
    final lead = _lead!;
    if ((stageId ?? '') == (lead.stageId ?? '')) return;
    String? reason;
    if (_pickers.stage(stageId)?.isLost == true) {
      reason = await showReasonSheet(context, title: 'Why was it lost?', confirmLabel: 'Mark lost', hint: 'e.g. Price too high');
      if (reason == null || !mounted) return;
    }
    await act(
      'stage',
      confirm: () async => true,
      send: () => widget.session.api.patchJson(leadPath(lead.id), leadStageBody(stageId, lostReason: reason)),
      done: 'Stage updated',
      reload: _reload,
    );
  }

  Future<void> _changeOwner(String? ownerId) async {
    final lead = _lead!;
    if ((ownerId ?? '') == (lead.ownerId ?? '')) return;
    await act(
      'owner',
      confirm: () async => true,
      send: () => widget.session.api.patchJson(leadPath(lead.id), leadOwnerBody(ownerId)),
      done: 'Owner updated',
      reload: _reload,
    );
  }

  Future<void> _saveValue() async {
    final lead = _lead!;
    final text = _value.text.trim();
    final value = text.isEmpty ? null : num.tryParse(text);
    if (text.isNotEmpty && (value == null || value < 0)) {
      toast('Enter a deal value of zero or more');
      return;
    }
    await act(
      'value',
      confirm: () async => true,
      send: () => widget.session.api.patchJson(leadPath(lead.id), leadDealValueBody(value)),
      done: 'Deal value saved',
      reload: _reload,
    );
  }

  Future<void> _addComment() async {
    final text = _comment.text.trim();
    if (text.isEmpty) {
      toast('Write a comment first');
      return;
    }
    final lead = _lead!;
    await act(
      'comment',
      confirm: () async => true,
      send: () async {
        await widget.session.api.postJson(leadNotesPath(lead.id), leadNoteBody(text));
        _comment.clear();
      },
      done: 'Comment added',
      reload: _reload,
    );
  }

  Future<void> _deleteComment(LeadNote note) async {
    final lead = _lead!;
    await act(
      'note-${note.id}',
      confirm: () => askSheet(
        context,
        title: 'Delete this comment?',
        text: 'It is removed from the lead and from its chat. This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Not now',
      ),
      send: () => widget.session.api.deleteJson(leadNotePath(lead.id, note.id)),
      done: 'Comment deleted',
      reload: _reload,
    );
  }

  /// Asks, then links the customer whose number matches; with none, opens the short "add customer" form.
  Future<void> _convert() async {
    final lead = _lead!;
    if (busy.contains('convert')) return;
    setState(() => busy.add('convert'));
    Map<String, dynamic>? match;
    try {
      final body = await widget.session.api.getJson(leadConvertPath(lead.id));
      match = body['match'] is Map ? Map<String, dynamic>.from(body['match'] as Map) : null;
    } on ApiException catch (e) {
      toast(e.message);
      if (mounted) setState(() => busy.remove('convert'));
      return;
    } catch (_) {
      toast('Could not look up the customer. Try again.');
      if (mounted) setState(() => busy.remove('convert'));
      return;
    }
    if (mounted) setState(() => busy.remove('convert'));
    if (!mounted) return;

    String? customerId;
    if (match != null) {
      final id = match['id']?.toString() ?? '';
      final name = match['name']?.toString() ?? 'this customer';
      var linked = false;
      await act(
        'convert',
        confirm: () => askSheet(
          context,
          title: 'Convert ${lead.name}?',
          text: '$name already has this number. Link this lead to them?',
          confirmLabel: 'Link to $name',
          cancelLabel: 'Not now',
          danger: false,
        ),
        send: () async {
          await widget.session.api.postJson(leadConvertPath(lead.id), convertBody(id));
          linked = true;
        },
        done: 'Lead linked to $name',
        reload: _reload,
      );
      if (linked) customerId = id;
    } else {
      customerId = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => ConvertCustomerScreen(session: widget.session, lead: lead)));
      await _reload();
    }
    if (customerId != null && customerId.isNotEmpty && mounted) _openCustomer(customerId);
  }

  /// A repeat enquiry from the same number. An open lead is closed as lost first, after asking.
  Future<void> _newEnquiry() async {
    final lead = _lead!;
    if (busy.contains('enquiry')) return;
    Future<bool> confirm() => askSheet(
          context,
          title: 'Start a new enquiry?',
          text: 'This number already has an open lead. It will be closed as lost ("New enquiry") and a new lead opened.',
          confirmLabel: 'Close it and start',
          cancelLabel: 'Not now',
          danger: false,
        );
    var confirmed = false;
    if (!lead.isClosed) {
      confirmed = await confirm();
      if (!confirmed || !mounted) return;
    }
    setState(() => busy.add('enquiry'));
    String? newId;
    try {
      Future<Map<String, dynamic>> send() => widget.session.api.postJson(newEnquiryPath(lead.id), newEnquiryBody(confirmed));
      Map<String, dynamic> body;
      try {
        body = await send();
      } on ApiException catch (e) {
        // A closed lead whose number has another open lead: ask before closing that one.
        if (e.code != 'LEAD_OPEN' || confirmed) rethrow;
        if (!mounted || !await confirm()) {
          if (mounted) setState(() => busy.remove('enquiry'));
          return;
        }
        confirmed = true;
        body = await send();
      }
      final l = body['lead'];
      newId = l is Map ? l['id']?.toString() : null;
      toast('New enquiry started', tone: KTone.positive);
    } on ApiException catch (e) {
      toast(e.message);
    } catch (_) {
      toast('Could not start a new enquiry. Try again.');
    }
    if (!mounted) return;
    setState(() => busy.remove('enquiry'));
    if (newId != null && newId.isNotEmpty) {
      await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
        builder: (_) => LeadProfileScreen(session: widget.session, leadId: newId!, isSupervisor: widget.isSupervisor),
      ));
    } else {
      await _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final lead = _lead;
    return PayListPage(
      title: lead?.name ?? 'Lead',
      loading: loading,
      error: _notFound ? null : error,
      notInPlan: notInPlan,
      onRetry: _load,
      emptyTitle: 'This lead was not found, or you cannot see it',
      emptyBody: 'It may have been removed, or it belongs to someone else\'s chats.',
      emptyIcon: LucideIcons.userX,
      rows: lead == null ? const [] : _rows(lead),
    );
  }

  List<Widget> _rows(Lead lead) {
    final stageOptions = <(String, String)>[('', 'Not on the pipeline'), for (final s in _pickers.stages) (s.id, s.name)];
    final ownerOptions = <(String, String)>[
      ('', 'Nobody'),
      for (final p in _pickers.people) (p.id, p.name),
      if (lead.ownerId != null && !_pickers.people.any((p) => p.id == lead.ownerId)) (lead.ownerId!, lead.ownerName ?? 'Current owner'),
    ];
    return [
      _header(lead),
      _actions(lead),
      KFormSection(title: 'Pipeline', children: [
        KPickField<String>(label: 'Pipeline stage', value: lead.stageId ?? '', options: stageOptions, onChanged: _changeStage),
        if (lead.isLost && lead.lostReason != null) Text('Lost: ${lead.lostReason}', style: AppText.caption),
        if (lead.stageId != null) ...[
          KTextField(
            label: 'Deal value (₹)',
            controller: _value,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _valueEdited = true),
          ),
          if (_valueEdited) KButton.secondary(label: 'Save deal value', expand: false, onPressed: busy.contains('value') ? null : _saveValue),
        ],
        KPickField<String>(label: 'Owner', value: lead.ownerId ?? '', options: ownerOptions, onChanged: _changeOwner),
      ]),
      if (lead.note != null) KFormSection(title: 'Note', children: [Text(lead.note!, style: AppText.body)]),
      if (lead.summary != null) KFormSection(title: 'AI summary', children: [Text(lead.summary!, style: AppText.body)]),
      _comments(lead),
      _followups(lead),
      if (lead.otherLeads.isNotEmpty) _others(lead),
      KCard(
        child: KListRow(
          title: 'More on the website',
          subtitle: 'Add or finish reminders, message a lead with no chat yet, set the expected close date, edit the note.',
          leading: const Icon(LucideIcons.globe, size: 20, color: AppColors.ink2),
          trailing: Icon(LucideIcons.chevronRight, size: 18, color: AppColors.ink3),
          onTap: () => openWebsiteInApp(context, widget.session, '/whatsapp/leads?lead=${Uri.encodeQueryComponent(lead.id)}', 'Lead'),
        ),
      ),
    ];
  }

  Widget _header(Lead lead) {
    return KCard(
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(lead.name, style: AppText.heading),
          const SizedBox(height: 4),
          Text(formatLeadPhone(lead.phone), style: AppText.body),
          const SizedBox(height: AppSpace.sm),
          Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
            KPill(label: lead.isExisting ? 'Existing' : 'New', tone: lead.isExisting ? KTone.due : KTone.positive),
            KPill(label: lead.isClosed ? 'Closed ${ddMMMyyyyHm(lead.closedAt!).split(',').first}' : 'Open', tone: lead.isClosed ? KTone.neutral : KTone.brand),
            if (lead.temperatureText.isNotEmpty) KPill(label: lead.temperatureText, tone: lead.temperature == 'hot' ? KTone.negative : KTone.neutral),
          ]),
          const SizedBox(height: AppSpace.sm),
          Text('Source: ${lead.sourceText}', style: AppText.caption),
          Text('Opened ${lead.openedAt == null ? '' : ddMMMyyyyHm(lead.openedAt!)} · ${lead.messagesText}', style: AppText.caption),
        ]),
      ),
    );
  }

  Widget _actions(Lead lead) {
    return Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
      if (lead.hasChat)
        KButton(
          label: 'Open chat',
          icon: LucideIcons.messageCircle,
          expand: false,
          onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
            builder: (_) => ChatThreadScreen(session: widget.session, conversationId: lead.conversationId!, title: lead.name),
          )),
        ),
      if (lead.customerId != null)
        KButton.secondary(label: 'View customer', icon: LucideIcons.userCheck, expand: false, onPressed: () => _openCustomer(lead.customerId!))
      else
        KButton.secondary(label: 'Convert to customer', icon: LucideIcons.userCheck, expand: false, onPressed: busy.contains('convert') ? null : _convert),
      KButton.secondary(label: 'New enquiry', icon: LucideIcons.rotateCcw, expand: false, onPressed: busy.contains('enquiry') ? null : _newEnquiry),
    ]);
  }

  Widget _comments(Lead lead) {
    return KFormSection(title: 'Comments', children: [
      if (_notes.isNotEmpty)
        KCard(
          child: KDivided(children: [
            for (final n in _notes)
              KListRow(
                title: n.text,
                subtitle: [n.author, if (n.createdAt != null) ddMMMyyyyHm(n.createdAt!)].join(' · '),
                trailing: widget.isSupervisor || n.authorId == _me
                    ? KIconButton(icon: LucideIcons.trash2, tooltip: 'Delete comment', onTap: () => _deleteComment(n))
                    : null,
              ),
          ]),
        ),
      KTextField(label: 'Add a comment', controller: _comment, maxLines: 3, maxLength: 4000),
      KButton.secondary(label: 'Add comment', expand: false, onPressed: busy.contains('comment') ? null : _addComment),
    ]);
  }

  Widget _followups(Lead lead) {
    final now = DateTime.now();
    return KFormSection(title: 'Follow-ups', children: [
      if (lead.followups.isEmpty)
        Text('No reminders on this lead.', style: AppText.caption)
      else
        KCard(
          child: KDivided(children: [
            for (final f in lead.followups)
              KListRow(
                title: ddMMMyyyyHm(f.dueAt),
                subtitle: [if ((f.note ?? '').isNotEmpty) f.note!, if ((f.assignedName ?? '').isNotEmpty) f.assignedName!].join(' · '),
                trailing: f.dueAt.isBefore(now) ? const KPill(label: 'Overdue', tone: KTone.negative) : null,
              ),
          ]),
        ),
    ]);
  }

  Widget _others(Lead lead) {
    return KFormSection(title: 'Other leads from this number', children: [
      KCard(
        child: KDivided(children: [
          for (final o in lead.otherLeads)
            KListRow(
              title: ddMMMyyyyHm(o.openedAt).split(',').first,
              subtitle: o.stageName ?? 'Not on the pipeline',
              trailing: Text(o.isClosed ? 'Closed' : 'Open', style: AppText.small),
              onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => LeadProfileScreen(session: widget.session, leadId: o.id, isSupervisor: widget.isSupervisor),
              )),
            ),
        ]),
      ),
    ]);
  }
}

/// Website "Convert to customer" when no customer has the lead's number: the short customer form, then
/// the lead is linked. Pops with the customer's id. Asks first, naming the lead.
class ConvertCustomerScreen extends StatefulWidget {
  const ConvertCustomerScreen({super.key, required this.session, required this.lead});

  final AppSession session;
  final Lead lead;

  @override
  State<ConvertCustomerScreen> createState() => _ConvertCustomerScreenState();
}

class _ConvertCustomerScreenState extends State<ConvertCustomerScreen> {
  late final _name = TextEditingController(text: widget.lead.name);
  late final _phone = TextEditingController(text: widget.lead.phone);
  final _gstin = TextEditingController();
  final _address = TextEditingController();

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _gstin.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      showKToast(context, 'Enter the customer name', tone: KTone.negative);
      return;
    }
    final ok = await askSheet(
      context,
      title: 'Add $name as a customer?',
      text: 'This adds $name to your customers and links ${widget.lead.name} to them.',
      confirmLabel: 'Create and link',
      cancelLabel: 'Not now',
      danger: false,
    );
    if (!ok || !mounted) return;
    final api = widget.session.api;
    // A phone or email already on a customer comes back with that customer and deduplicated: true
    // (a 4xx, so it arrives as an ApiException); that customer is the one to link.
    Map<String, dynamic> created;
    try {
      created = await api.postJson('/api/customers', newCustomerBody(name: name, phone: _phone.text, gstin: _gstin.text, address: _address.text));
    } on ApiException catch (e) {
      if (e.body['deduplicated'] != true || e.body['customer'] is! Map) rethrow;
      created = e.body;
    }
    final c = created['customer'];
    final id = c is Map ? c['id']?.toString() : null;
    if (id == null || id.isEmpty) throw ApiException('Could not create the customer');
    final existing = created['deduplicated'] == true;
    final customerName = c is Map ? (c['name']?.toString() ?? name) : name;
    try {
      await api.postJson(leadConvertPath(widget.lead.id), convertBody(id));
    } on ApiException catch (e) {
      final what = existing ? '$customerName already exists as a customer, but the lead could not be linked' : 'The customer was added, but the lead could not be linked';
      throw ApiException('$what (${e.message}). Tap Convert to customer again to link it.');
    }
    if (!mounted) return;
    showKToast(context, existing ? 'Linked to existing customer $customerName' : 'Customer added and lead linked', tone: KTone.positive);
    Navigator.of(context).pop(id);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'Convert to customer',
      saveLabel: 'Create and link',
      onSave: _save,
      children: [
        Text('No customer has this number yet. Add one and link the lead.', style: AppText.caption),
        KTextField(label: 'Name', controller: _name, maxLength: 200),
        KTextField(label: 'Phone', controller: _phone, keyboard: TextInputType.phone),
        KTextField(label: 'GSTIN (optional)', controller: _gstin, caps: true, maxLength: 15),
        KTextField(label: 'Address (optional)', controller: _address, maxLines: 2, maxLength: 500),
      ],
    );
  }
}
