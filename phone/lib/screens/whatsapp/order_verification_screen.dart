import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/authed_image.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../pages/native_routes.dart';
import '../sales/doc_action_sheets.dart';
import 'order_verification_logic.dart';

/// Website `/whatsapp/orders` ("Pending WhatsApp Orders"): orders customers placed on WhatsApp, waiting
/// for the payment to be checked. Each card shows the items, the payment proof (online payment, or the
/// screenshot with the AI check) and two actions: Approve makes the paid invoice; Reject cancels the
/// order with a reason. Everything the website page does is here.
class OrderVerificationScreen extends StatefulWidget {
  const OrderVerificationScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<OrderVerificationScreen> createState() => _OrderVerificationScreenState();
}

class _OrderVerificationScreenState extends State<OrderVerificationScreen> {
  List<WhatsAppOrderRow> _rows = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  int _page = 1;
  int _seq = 0;
  final Set<String> _busy = {};
  final Set<String> _asking = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final seq = ++_seq;
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/orders?status=draft');
      if (!mounted || seq != _seq) return;
      setState(() {
        _rows = whatsAppOrderRows(body['orders']);
        _page = _page.clamp(1, orderPageCount(_rows.length));
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _seq) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted && seq == _seq) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  void _toast(String message, {KTone tone = KTone.negative}) {
    if (mounted) showKToast(context, message, tone: tone);
  }

  /// One decision at a time per order: the guard comes before the sheet opens, so a double tap cannot
  /// open two sheets or post twice.
  Future<void> _decide(
    WhatsAppOrderRow row, {
    required Future<Object?> Function() ask,
    required Future<String?> Function(Object answer) send,
    required String failure,
  }) async {
    if (_busy.contains(row.id) || !_asking.add(row.id)) return;
    Object? answer;
    try {
      answer = await ask();
    } finally {
      _asking.remove(row.id);
    }
    if (answer == null || !mounted || _busy.contains(row.id)) return;
    setState(() => _busy.add(row.id));
    try {
      final done = await send(answer);
      if (done != null) _toast(done, tone: KTone.positive);
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast(failure);
    }
    if (mounted) setState(() => _busy.remove(row.id));
    // The order may already have been decided somewhere else, so the list reloads after a refusal too.
    if (mounted) await _load();
  }

  Future<void> _approve(WhatsAppOrderRow row) => _decide(
        row,
        ask: () async => await askSheet(
          context,
          title: 'Approve Order?',
          text: 'Are you sure you want to approve this payment and create an invoice for ${inr(row.total)} (${row.number}, ${row.customer})?',
          confirmLabel: 'Approve',
          cancelLabel: 'Not yet',
          danger: false,
        )
            ? true
            : null,
        send: (_) async {
          final res = await widget.session.api.postJson('/api/whatsapp/orders/${row.id}/approve', const {});
          final number = res['invoice_number']?.toString();
          return number == null ? 'Order approved' : 'Approved · invoice $number created';
        },
        failure: 'Could not approve. Try again.',
      );

  Future<void> _reject(WhatsAppOrderRow row) => _decide(
        row,
        ask: () => showReasonSheet(
          context,
          title: 'Reject Order?',
          confirmLabel: 'Reject Order',
          hint: 'Payment could not be verified',
        ),
        send: (reason) async {
          await widget.session.api.postJson('/api/whatsapp/orders/${row.id}/reject', {
            if ((reason as String).isNotEmpty) 'reason': reason,
          });
          return 'Order rejected';
        },
        failure: 'Could not reject. Try again.',
      );

  void _showProof(String url) {
    showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: AppColors.surface,
        child: Stack(children: [
          InteractiveViewer(
            child: AuthedImage(
              api: widget.session.api,
              url: url,
              fit: BoxFit.contain,
              failed: Padding(padding: const EdgeInsets.all(AppSpace.xl), child: Text('Payment screenshot could not be shown', style: AppText.caption)),
            ),
          ),
          Positioned(top: AppSpace.xs, right: AppSpace.xs, child: KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.of(ctx).pop())),
        ]),
      ),
    );
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
            KBackBar('Order Verification', trailing: KIconButton(icon: LucideIcons.refreshCw, tooltip: 'Refresh', onTap: _loading ? () {} : _load)),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: AppSpace.xxl * 2));
    if (_error != null) {
      return ListView(children: [
        KEmptyState(
          icon: _notInPlan ? LucideIcons.lock : LucideIcons.cloudOff,
          title: _notInPlan ? 'Not included in your current plan' : 'Could not load orders',
          body: _error,
          action: _notInPlan ? null : KButton.secondary(label: 'Try again', expand: false, onPressed: _load),
        ),
      ]);
    }
    final pages = orderPageCount(_rows.length);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xxl),
        children: [
          Text(
            'Verify payments from the WhatsApp AI agent: online checkout updates automatically when your payment provider confirms; manual UPI can use a screenshot.',
            style: AppText.caption,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpace.xs),
            child: Align(
              alignment: Alignment.centerLeft,
              child: KTextButton(
                label: 'Paid orders, dispatch and delivery are in Orders & delivery',
                onTap: () => openAppHref(context, widget.session, '/orders?channel=whatsapp', 'Orders & delivery'),
              ),
            ),
          ),
          if (_rows.isEmpty)
            const KEmptyState(
              icon: LucideIcons.shoppingCart,
              title: 'No pending orders',
              body: 'All WhatsApp orders have been verified or there are no new orders.',
            )
          else ...[
            for (final row in orderPage(_rows, _page)) ...[
              _card(row),
              const SizedBox(height: AppSpace.sm),
            ],
            if (pages > 1)
              Row(children: [
                Expanded(child: Text('Page $_page of $pages', style: AppText.caption)),
                KButton.secondary(label: 'Previous', expand: false, height: 40, onPressed: _page <= 1 ? null : () => setState(() => _page--)),
                const SizedBox(width: AppSpace.sm),
                KButton.secondary(label: 'Next', expand: false, height: 40, onPressed: _page >= pages ? null : () => setState(() => _page++)),
              ]),
          ],
        ],
      ),
    );
  }

  Widget _card(WhatsAppOrderRow row) {
    final busy = _busy.contains(row.id);
    return KCard(
      child: Padding(
        padding: const EdgeInsets.all(AppSpace.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(row.customer, style: AppText.bodyStrong),
                  Text(
                    [row.number, if (row.placedAt != null) orderPlacedText(row.placedAt!) else if (row.date != null) ddMMMyyyy(row.date!)].join(' · '),
                    style: AppText.caption,
                  ),
                  if (row.phone != null) Text(row.phone!, style: AppText.caption),
                ]),
              ),
              KAmount(row.total, style: AppText.heading),
            ]),
            if (row.items.isNotEmpty) ...[
              const SizedBox(height: AppSpace.sm),
              Text('ORDER ITEMS', style: AppText.caption.copyWith(fontWeight: FontWeight.w600)),
              const SizedBox(height: AppSpace.xs),
              KDivided(children: [
                for (final item in row.items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpace.sm),
                    child: Row(children: [
                      Expanded(child: Text(item.text, style: AppText.body)),
                      Text(inr(item.total, maxFraction: 2), style: AppText.bodyStrong),
                    ]),
                  ),
              ]),
            ],
            const SizedBox(height: AppSpace.sm),
            Text('PAYMENT VERIFICATION', style: AppText.caption.copyWith(fontWeight: FontWeight.w600)),
            const SizedBox(height: AppSpace.xs),
            _proof(row),
            const SizedBox(height: AppSpace.md),
            Row(children: [
              Expanded(child: KButton(label: 'Verify & Create Invoice', height: 44, loading: busy, onPressed: busy ? null : () => _approve(row))),
              const SizedBox(width: AppSpace.sm),
              Expanded(child: KButton(label: 'Reject', height: 44, kind: KButtonKind.secondary, onPressed: busy ? null : () => _reject(row))),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _proof(WhatsAppOrderRow row) {
    switch (row.proof) {
      case OrderProof.online:
        return _panel(
          tone: KTone.positive,
          icon: LucideIcons.circleCheck,
          title: onlinePaymentTitle(row.paymentStatus),
          children: [
            Text('Your payment provider reported a successful collection. No customer screenshot is required for this checkout flow.', style: AppText.caption),
            if (row.paymentReference != null) _fact('Reference / UTR', row.paymentReference!),
            if (row.paymentMethod != null) _fact('Method', row.paymentMethod!),
            if (row.ocr?.source != null) _fact('Source', row.ocr!.source!),
            if (row.paymentProofUrl != null)
              Text('A screenshot was also attached; online confirmation above is sufficient to verify and invoice.', style: AppText.caption),
          ],
        );
      case OrderProof.screenshot:
        final (title, tone) = ocrProofPresentation(row.ocrStatus);
        final ocr = row.ocr;
        return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          GestureDetector(
            onTap: () => _showProof(row.paymentProofUrl!),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: AuthedImage(
                api: widget.session.api,
                url: row.paymentProofUrl!,
                height: 160,
                width: double.infinity,
                failed: Text('Payment screenshot could not be shown', style: AppText.caption),
              ),
            ),
          ),
          const SizedBox(height: AppSpace.sm),
          _panel(
            tone: switch (tone) {
              ProofTone.good => KTone.positive,
              ProofTone.review => KTone.due,
              ProofTone.bad => KTone.negative,
              _ => KTone.neutral,
            },
            icon: switch (tone) {
              ProofTone.good => LucideIcons.circleCheck,
              ProofTone.review => LucideIcons.circleAlert,
              ProofTone.bad => LucideIcons.circleX,
              ProofTone.info => LucideIcons.info,
              ProofTone.pending => LucideIcons.loader,
            },
            title: 'Payment proof: $title',
            children: [
              if (ocr != null) ...[
                if (ocr.source != null) _fact('Source', ocr.source!),
                _fact('Detected amount', ocr.amountText),
                _fact('Confidence', ocr.confidenceText, tone: ocr.confident ? KTone.positive : KTone.due),
                if (ocr.upi != null) _fact('Receiver UPI', ocr.upi!),
                if (ocr.summary != null) Text('Validation: ${ocr.summary}', style: AppText.caption),
                if (ocr.note != null) Text('AI note: ${ocr.note}', style: AppText.caption),
              ],
            ],
          ),
        ]);
      case OrderProof.none:
        return _panel(
          tone: KTone.neutral,
          icon: LucideIcons.image,
          title: 'No payment proof uploaded yet',
          children: [
            Text('If the customer paid using your payment link, this updates automatically when your provider notifies us (no screenshot needed).', style: AppText.caption),
            Text('For manual UPI transfers, wait for the customer to send a screenshot in WhatsApp.', style: AppText.caption),
          ],
        );
    }
  }

  Widget _panel({required KTone tone, required IconData icon, required String title, required List<Widget> children}) {
    return Container(
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.md)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, size: 18, color: tone.fg),
          const SizedBox(width: AppSpace.sm),
          Expanded(child: Text(title, style: AppText.bodyStrong.copyWith(color: tone.fg))),
        ]),
        for (final c in children) ...[const SizedBox(height: AppSpace.xs), c],
      ]),
    );
  }

  Widget _fact(String label, String value, {KTone? tone}) => Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(child: Text(label, style: AppText.caption)),
        const SizedBox(width: AppSpace.sm),
        Flexible(child: Text(value, textAlign: TextAlign.end, style: AppText.label.copyWith(color: tone?.fg ?? AppColors.ink))),
      ]);
}
