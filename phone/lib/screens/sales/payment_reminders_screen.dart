import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import '../pages/website_page_screen.dart';
import '../settings/settings_router.dart';
import 'load_failed_view.dart';
import 'payment_reminders_logic.dart';

/// Website `/payments/reminders` (`/whatsapp/reminders` redirects to it): send WhatsApp reminders for unpaid invoices.
///
/// Sending messages customers. It sends only when WhatsApp is linked, only the ticked invoices, after the
/// owner has seen who gets one, and once per tap.
///
/// The website's History tab reads `/api/whatsapp/reminders/logs`, which the server does not have (that
/// path only exists for `PATCH` and `DELETE` of one reminder type), so the phone has no Sent tab.
class PaymentRemindersScreen extends StatefulWidget {
  const PaymentRemindersScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PaymentRemindersScreen> createState() => _PaymentRemindersScreenState();
}

class _PaymentRemindersScreenState extends State<PaymentRemindersScreen> {
  List<ReminderInvoice> _invoices = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  String _filter = 'both';
  final _search = TextEditingController();
  final Set<String> _ticked = {};

  /// Null until the first status answer. Not linked is false, and so is a status that cannot be read.
  bool? _linked;
  /// True from the tap on Send until the flow ends (status check, question, post): a second tap does nothing.
  bool _flow = false;

  /// True only while the request is out, for the spinner.
  bool _sending = false;
  final _template = TextEditingController(text: kDefaultReminderTemplate);
  bool _includePdf = true;

  @override
  void initState() {
    super.initState();
    _load();
    _refreshLinked();
  }

  @override
  void dispose() {
    _search.dispose();
    _template.dispose();
    super.dispose();
  }

  /// `GET /api/whatsapp/status`. Anything but a linked answer counts as not linked, as on the website.
  Future<bool> _refreshLinked() async {
    var linked = false;
    try {
      final status = await widget.session.api.getJson('/api/whatsapp/status');
      linked = whatsAppLinked(status, hasConnect: widget.session.hasModule('connect'));
    } catch (_) {
      linked = false;
    }
    if (mounted) setState(() => _linked = linked);
    return linked;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/invoices/for-reminders?payment_status=$_filter');
      if (!mounted) return;
      final rows = reminderInvoices(body['invoices']);
      setState(() {
        _invoices = rows;
        _ticked.retainWhere((id) => rows.any((r) => r.id == id));
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = LoadFailedView.isPlanBlock(e);
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  List<ReminderInvoice> get _shown => filterDocs(
        [for (final i in _invoices) {'n': i.number, 'c': i.customerName, 'o': i}],
        _search.text,
        ['n', 'c'],
      ).map((r) => r['o'] as ReminderInvoice).toList();

  void _toggle(String id) => setState(() => _ticked.contains(id) ? _ticked.remove(id) : _ticked.add(id));

  void _selectAll() {
    final shown = _shown;
    setState(() {
      if (shown.every((i) => _ticked.contains(i.id))) {
        _ticked.removeAll(shown.map((i) => i.id));
      } else {
        _ticked.addAll(shown.map((i) => i.id));
      }
    });
  }

  void _connect() => openPhoneSetting(context, widget.session, '/settings/whatsapp');

  /// Checks the link again, shows who will be messaged, and posts once. Nothing is sent when WhatsApp is not
  /// linked or the owner says no.
  Future<void> _send() async {
    if (_flow || _ticked.isEmpty) return;
    if (_template.text.trim().isEmpty) {
      showKToast(context, 'Please enter a message template', tone: KTone.negative);
      return;
    }
    setState(() => _flow = true);
    try {
      if (!await _refreshLinked() || !mounted) return;
      final body = reminderBody(invoices: _invoices, ticked: _ticked, template: _template.text, includePdf: _includePdf);
      final ids = (body['invoice_ids'] as List).cast<String>();
      if (ids.isEmpty) return;
      final chosen = [for (final i in _invoices) if (ids.contains(i.id)) i];
      final ok = await showKSheet<bool>(
        context,
        title: 'Send reminders',
        scrollable: true,
        builder: (ctx) => _ConfirmSendSheet(invoices: chosen),
      );
      if (ok != true || !mounted) return;
      setState(() => _sending = true);
      final reply = await widget.session.api.postJson('/api/whatsapp/send-bulk-reminders', body);
      if (!mounted) return;
      final failed = (docNum(reply['failed_count']) ?? 0) > 0;
      showKToast(context, reminderResultText(reply), tone: failed ? KTone.due : KTone.positive);
      setState(_ticked.clear);
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'WHATSAPP_NOT_CONNECTED') {
        setState(() => _linked = false);
      } else if (e.code == 'BATCH_TOO_LARGE') {
        showKToast(context, 'Cannot send reminders: ${e.message}', tone: KTone.negative);
      } else {
        showKToast(context, 'Failed to send reminders: ${e.message}', tone: KTone.negative);
      }
    } catch (_) {
      if (mounted) showKToast(context, 'Failed to send reminders', tone: KTone.negative);
    } finally {
      if (mounted) {
        setState(() {
          _flow = false;
          _sending = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final linked = _linked == true;
    final n = _ticked.length;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Payment reminders',
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                KIconButton(
                  icon: LucideIcons.settings,
                  tooltip: 'Auto reminder settings',
                  onTap: () => openPhoneSetting(context, widget.session, '/settings/whatsapp/notifications'),
                ),
                KIconButton(
                  icon: LucideIcons.globe,
                  tooltip: 'Open on website',
                  onTap: () => openWebsiteInApp(context, widget.session, '/payments/reminders', 'Payment reminders'),
                ),
              ]),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
      bottomNavigationBar: _loading || _error != null || !linked
          ? null
          : KBottomBar(children: [
              Expanded(
                child: KButton(
                  label: n == 0 ? 'Send reminders' : 'Send reminder to $n invoice(s)',
                  icon: LucideIcons.messageCircle,
                  loading: _sending,
                  onPressed: n == 0 || _flow ? null : _send,
                ),
              ),
            ]),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    if (_error != null) {
      return ListView(children: [
        LoadFailedView(title: 'Could not load invoices', message: _error, notInPlan: _notInPlan, onRetry: _load),
      ]);
    }
    final shown = _shown;
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(0, 0, 0, AppSpace.xl),
        children: [
          if (_linked == false) _notLinkedBanner(),
          KChipBar<String>(
            value: _filter,
            options: [for (final (k, l) in kReminderStatusFilters) (k, l)],
            onChanged: (v) {
              if (v == _filter) return;
              setState(() => _filter = v);
              _load();
            },
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.sm),
            child: KSearchField(controller: _search, hint: 'Invoice # or customer', onChanged: (_) => setState(() {})),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: Row(children: [
              Expanded(child: Text('${_ticked.length} selected', style: AppText.caption)),
              if (shown.isNotEmpty) KTextButton(label: 'Select all', onTap: _selectAll),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: shown.isEmpty
                ? const KEmptyState(
                    icon: LucideIcons.bell,
                    title: 'No invoices found',
                    body: 'Unpaid invoices whose customer has a phone number show up here.',
                  )
                : KCard(child: KDivided(indent: 0, children: [for (final i in shown) _row(i)])),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xl, AppSpace.gutter, 0),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const KSectionHeader('Message'),
              KTextField(
                label: 'Message template',
                controller: _template,
                maxLines: 10,
                minLines: 5,
                onChanged: (_) => setState(() {}),
              ),
              const SizedBox(height: AppSpace.xs),
              Text(
                'Placeholders: {customer_name}, {invoice_no}, {amount}, {due_date}, {balance_amount}, {business_name}',
                style: AppText.caption,
              ),
              const SizedBox(height: AppSpace.md),
              KToggleField(label: 'Include PDF attachment', value: _includePdf, onChanged: (v) => setState(() => _includePdf = v)),
            ]),
          ),
        ],
      ),
    );
  }

  Widget _notLinkedBanner() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.md),
      child: KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('WhatsApp is not connected', style: AppText.bodyStrong.copyWith(color: AppColors.due)),
            const SizedBox(height: 4),
            Text(
              'Reminders stay here until you scan a QR code or connect the WhatsApp Business API.',
              style: AppText.body,
            ),
            const SizedBox(height: AppSpace.md),
            KButton.secondary(label: 'Connect WhatsApp', expand: false, onPressed: _connect),
          ],
        ),
      ),
    );
  }

  Widget _row(ReminderInvoice i) {
    final on = _ticked.contains(i.id);
    return Semantics(
      container: true,
      checked: on,
      child: InkWell(
        onTap: () => _toggle(i.id),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(children: [
            Icon(on ? LucideIcons.squareCheck : LucideIcons.square, size: 22, color: on ? AppColors.brand : AppColors.ink3),
            const SizedBox(width: AppSpace.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(i.customerName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                Text(
                  '${i.number}${i.dueDate == null ? '' : ' · due ${ddMMMyyyy(i.dueDate!)}'}',
                  style: AppText.caption,
                ),
              ]),
            ),
            const SizedBox(width: AppSpace.sm),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Text(inr(i.balance, maxFraction: 2), style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
              Text(i.statusLabel, style: AppText.caption),
            ]),
          ]),
        ),
      ),
    );
  }
}

/// Who gets a message, and how many. Pops true on "Send"; a double tap answers once.
class _ConfirmSendSheet extends StatefulWidget {
  const _ConfirmSendSheet({required this.invoices});

  final List<ReminderInvoice> invoices;

  @override
  State<_ConfirmSendSheet> createState() => _ConfirmSendSheetState();
}

class _ConfirmSendSheetState extends State<_ConfirmSendSheet> {
  bool _tapped = false;

  void _done(bool value) {
    if (_tapped) return;
    _tapped = true;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    final n = widget.invoices.length;
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Send a WhatsApp reminder to $n invoice(s)?', style: AppText.bodyStrong),
          const SizedBox(height: AppSpace.sm),
          KCard(
            child: KDivided(indent: 0, children: [
              for (final i in widget.invoices)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  child: Row(children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(i.customerName, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                        Text(i.number, style: AppText.caption),
                      ]),
                    ),
                    Text(inr(i.balance, maxFraction: 2), style: AppText.body),
                  ]),
                ),
            ]),
          ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: n == 1 ? 'Send 1 reminder' : 'Send $n reminders', onPressed: () => _done(true)),
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(label: 'Cancel', onPressed: () => _done(false)),
        ],
      ),
    );
  }
}
