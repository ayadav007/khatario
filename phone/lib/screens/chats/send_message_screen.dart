import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../capability.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../sales/doc_action_sheets.dart';
import 'campaign_send_form.dart';
import 'campaigns_logic.dart';
import 'send_message_parts.dart';

enum _SendTab { single, campaign }

/// Website `/whatsapp/send-message`: a message to one number, or a bulk campaign. Pictures are
/// sent on the website. [phone] fills the number (from a contact), [draft] opens the campaign tab
/// with the people Who to message chose. [capabilities] hides the form on a plan without Connect.
class SendMessageScreen extends StatefulWidget {
  const SendMessageScreen({super.key, required this.session, this.phone, this.draft, this.capabilities, this.startOnCampaign = false, this.clock});

  final AppSession session;
  final String? phone;
  final SendDraft? draft;
  final Capabilities? capabilities;

  /// Opens on the Bulk campaign tab (the Campaigns screen's "New campaign").
  final bool startOnCampaign;

  /// The current time, for the schedule check. Tests give a fixed one.
  final DateTime? clock;

  @override
  State<SendMessageScreen> createState() => _SendMessageScreenState();
}

class _SendMessageScreenState extends State<SendMessageScreen> {
  late _SendTab _tab = widget.draft != null || widget.startOnCampaign ? _SendTab.campaign : _SendTab.single;
  late bool _campaignOpened = widget.draft != null || widget.startOnCampaign;

  bool get _locked {
    final caps = widget.capabilities;
    if (caps == null) return false;
    final r = caps.check('whatsapp_bot');
    return !r.allowed && r.denialReason == 'FEATURE_NOT_IN_PLAN';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const KBackBar('Send WhatsApp message'),
          if (_locked)
            const KEmptyState(
              icon: LucideIcons.lock,
              title: 'Send message is locked',
              body: 'Your plan does not include sending WhatsApp messages and campaigns. Ask the account owner to upgrade it.',
            )
          else ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.sm),
              child: KSegmented<_SendTab>(
                value: _tab,
                options: const [(_SendTab.single, 'Single message'), (_SendTab.campaign, 'Bulk campaign')],
                onChanged: (v) => setState(() {
                  _tab = v;
                  if (v == _SendTab.campaign) _campaignOpened = true;
                }),
              ),
            ),
            Expanded(
              child: IndexedStack(index: _tab.index, children: [
                _SingleMessageForm(session: widget.session, phone: widget.phone),
                if (_campaignOpened) CampaignSendForm(session: widget.session, draft: widget.draft, clock: widget.clock) else const SizedBox.shrink(),
              ]),
            ),
          ],
        ]),
      ),
    );
  }
}

/// Website "Send Single Message": a number and a text or button message. Asks first, posts once.
class _SingleMessageForm extends StatefulWidget {
  const _SingleMessageForm({required this.session, this.phone});

  final AppSession session;
  final String? phone;

  @override
  State<_SingleMessageForm> createState() => _SingleMessageFormState();
}

class _SingleMessageFormState extends State<_SingleMessageForm> {
  late final _phone = TextEditingController(text: widget.phone ?? '');
  final _message = TextEditingController();
  final _buttons = ButtonsController();
  MessageKind _kind = MessageKind.text;
  MediaItem? _picture;
  bool _busy = false;

  @override
  void dispose() {
    _phone.dispose();
    _message.dispose();
    _buttons.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_busy) return;
    final buttons = _kind == MessageKind.buttons ? _buttons.value : null;
    final image = _kind == MessageKind.image;
    final problem = singleSendError(phone: _phone.text, text: _message.text, buttons: buttons, image: image, mediaUrl: _picture?.url);
    if (problem != null) {
      showKToast(context, problem, tone: KTone.negative);
      return;
    }
    final ask = singleSendAsk(_phone.text, _message.text);
    final sure = await askSheet(context, title: ask.title, text: ask.text, confirmLabel: ask.confirm, cancelLabel: ask.cancel, danger: false);
    if (!sure || !mounted || _busy) return;
    setState(() => _busy = true);
    try {
      await widget.session.api.postJson(sendPath, singleSendBody(phone: _phone.text, text: _message.text, buttons: buttons, image: image, mediaUrl: _picture?.url));
      if (!mounted) return;
      showKToast(context, 'Message sent successfully!', tone: KTone.positive);
      _phone.clear();
      _message.clear();
      setState(() {
        _buttons.clear();
        _picture = null;
      });
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not send the message. Try again.', tone: KTone.negative);
    }
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl * 3),
      children: [
        KSegmented<MessageKind>(value: _kind, options: messageKindOptions, onChanged: (v) => setState(() => _kind = v)),
        const SizedBox(height: AppSpace.md),
        KTextField(label: 'Phone number (with country code)', controller: _phone, hint: 'Country code and number', keyboard: TextInputType.phone),
        const SizedBox(height: AppSpace.xs),
        Text('Example: 919876543210 (India), 14155552671 (US)', style: AppText.caption),
        const SizedBox(height: AppSpace.md),
        KTextField(
          label: _kind == MessageKind.image ? 'Caption' : 'Message',
          controller: _message,
          hint: _kind == MessageKind.image ? 'Enter caption for the image...' : 'Enter your message...',
          maxLines: 6,
          minLines: 3,
        ),
        if (_kind == MessageKind.image) ...[
          const SizedBox(height: AppSpace.md),
          PictureField(session: widget.session, picture: _picture, onChanged: (m) => setState(() => _picture = m)),
        ],
        if (_kind == MessageKind.buttons) ...[const SizedBox(height: AppSpace.md), ButtonsEditor(controller: _buttons)],
        const SizedBox(height: AppSpace.md),
        const SizedBox(height: AppSpace.lg),
        KButton(label: 'Send message', icon: LucideIcons.send, loading: _busy, onPressed: _busy ? null : _send),
      ],
    );
  }
}
