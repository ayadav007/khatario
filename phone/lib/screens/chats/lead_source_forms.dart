import 'package:flutter/material.dart';

import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'lead_pickers.dart';
import 'lead_sources_logic.dart';

/// "Pipeline stage", "Give the chat to" and "Add labels": where a source's leads go.
class SourceRoutingFields extends StatelessWidget {
  const SourceRoutingFields({super.key, required this.routing, required this.pickers, required this.onChanged});

  final SourceRouting routing;
  final LeadPickers pickers;
  final ValueChanged<SourceRouting> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      KPickField<String>(
        label: 'Pipeline stage',
        value: routing.stageId ?? '',
        options: [('', 'First open stage'), for (final s in pickers.stages) (s.id, s.name)],
        onChanged: (v) => onChanged(routing.copyWith(stageId: v.isEmpty ? null : v)),
      ),
      const SizedBox(height: AppSpace.md),
      KPickField<String>(
        label: 'Give the chat to',
        value: routing.assignTo ?? '',
        options: [('', 'Nobody (Requesting queue)'), for (final p in pickers.people) (p.id, p.name)],
        onChanged: (v) => onChanged(routing.copyWith(assignTo: v.isEmpty ? null : v)),
      ),
      const SizedBox(height: AppSpace.md),
      Padding(padding: const EdgeInsets.only(bottom: AppSpace.sm, left: AppSpace.xs), child: Text('Add labels', style: AppText.label)),
      if (pickers.labels.isEmpty)
        Text('No labels yet', style: AppText.caption)
      else
        Wrap(spacing: AppSpace.sm, runSpacing: AppSpace.sm, children: [
          for (final l in pickers.labels)
            KChip(
              label: l.name,
              selected: routing.labelIds.contains(l.id),
              onTap: () => onChanged(routing.copyWith(
                labelIds: routing.labelIds.contains(l.id) ? [for (final x in routing.labelIds) if (x != l.id) x] : [...routing.labelIds, l.id],
              )),
            ),
        ]),
    ]);
  }
}

/// Website "Create link": a tracked link for an ad, bio or poster. Pops with true once created.
class LinkFormScreen extends StatefulWidget {
  const LinkFormScreen({super.key, required this.session, required this.pickers, this.suggestedPhone});

  final AppSession session;
  final LeadPickers pickers;
  final String? suggestedPhone;

  @override
  State<LinkFormScreen> createState() => _LinkFormScreenState();
}

class _LinkFormScreenState extends State<LinkFormScreen> {
  final _name = TextEditingController();
  late final _phone = TextEditingController(text: widget.suggestedPhone ?? '');
  final _text = TextEditingController();
  SourceRouting _routing = const SourceRouting();

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) return showKToast(context, 'Enter a name for the link', tone: KTone.negative);
    if (_phone.text.trim().isEmpty) return showKToast(context, 'Enter your WhatsApp number', tone: KTone.negative);
    await widget.session.api.postJson(entryLinksPath, entryLinkBody(name: _name.text, phone: _phone.text, prefillText: _text.text, routing: _routing));
    if (!mounted) return;
    showKToast(context, 'Link created', tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New tracked link',
      saveLabel: 'Create link',
      onSave: _save,
      dirty: _name.text.isNotEmpty,
      children: [
        Text('Put the link in an ad, Instagram bio or poster. A short code like "(ref K7Q2MX)" is added to the message so we can tell which link it came from.', style: AppText.caption),
        KTextField(label: 'Name', controller: _name, hint: 'e.g. Diwali poster', maxLength: 80, onChanged: (_) => setState(() {})),
        KTextField(label: 'Your WhatsApp number', controller: _phone, hint: '919876543210', keyboard: TextInputType.phone),
        KTextField(label: 'Message they send', controller: _text, hint: 'Hi! I would like to know more.', maxLength: 400),
        SourceRoutingFields(routing: _routing, pickers: widget.pickers, onChanged: (r) => setState(() => _routing = r)),
      ],
    );
  }
}

/// Website IndiaMART card: the CRM key and where its leads go. Pops with true once saved.
class IndiaMartFormScreen extends StatefulWidget {
  const IndiaMartFormScreen({super.key, required this.session, required this.pickers, this.source});

  final AppSession session;
  final LeadPickers pickers;

  /// The connected source, or null for a first connection (the key is then required).
  final LeadSource? source;

  @override
  State<IndiaMartFormScreen> createState() => _IndiaMartFormScreenState();
}

class _IndiaMartFormScreenState extends State<IndiaMartFormScreen> {
  final _key = TextEditingController();
  late SourceRouting _routing = widget.source?.routing ?? const SourceRouting();

  @override
  void dispose() {
    _key.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (widget.source == null && _key.text.trim().isEmpty) return showKToast(context, 'Paste your IndiaMART CRM key', tone: KTone.negative);
    await widget.session.api.postJson(leadSourcesPath, indiaMartBody(key: _key.text, routing: _routing));
    if (!mounted) return;
    showKToast(context, widget.source == null ? 'IndiaMART connected. New leads arrive every 10 minutes.' : 'IndiaMART settings saved', tone: KTone.positive);
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'IndiaMART',
      saveLabel: 'Save IndiaMART',
      onSave: _save,
      dirty: _key.text.isNotEmpty,
      children: [
        Text('New buy-leads become WhatsApp chats on your pipeline, with the enquiry attached. IndiaMART lets us check once every 5 minutes.', style: AppText.caption),
        KTextField(
          label: widget.source == null ? 'IndiaMART CRM key' : 'Replace CRM key (optional)',
          controller: _key,
          obscure: true,
          hint: widget.source == null ? 'From IndiaMART Lead Manager, Import/Export, CRM API' : 'Saved. Paste a new one to replace it.',
          onChanged: (_) => setState(() {}),
        ),
        SourceRoutingFields(routing: _routing, pickers: widget.pickers, onChanged: (r) => setState(() => _routing = r)),
        Text('A new lead has not messaged you on WhatsApp yet, so start the conversation with an approved template.', style: AppText.caption),
      ],
    );
  }
}

/// Website "Create webhook URL": a private URL that turns any lead into a WhatsApp chat. Pops with the
/// URL, which the server shows only once.
class WebhookFormScreen extends StatefulWidget {
  const WebhookFormScreen({super.key, required this.session, required this.pickers});

  final AppSession session;
  final LeadPickers pickers;

  @override
  State<WebhookFormScreen> createState() => _WebhookFormScreenState();
}

class _WebhookFormScreenState extends State<WebhookFormScreen> {
  final _name = TextEditingController();
  SourceRouting _routing = const SourceRouting();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final body = await widget.session.api.postJson(leadSourcesPath, webhookBody(name: _name.text, routing: _routing));
    if (!mounted) return;
    final url = webhookUrlFrom(body);
    if (url == null) throw Exception('No URL came back');
    Navigator.of(context).pop(url);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: 'New webhook',
      saveLabel: 'Create webhook URL',
      onSave: _save,
      dirty: _name.text.isNotEmpty,
      children: [
        Text('For JustDial, Facebook lead forms or your website form, through Zapier or Make.', style: AppText.caption),
        KTextField(label: 'Name', controller: _name, hint: 'e.g. JustDial via Zapier', maxLength: 80, onChanged: (_) => setState(() {})),
        SourceRoutingFields(routing: _routing, pickers: widget.pickers, onChanged: (r) => setState(() => _routing = r)),
      ],
    );
  }
}
