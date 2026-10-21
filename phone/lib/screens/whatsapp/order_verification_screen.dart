import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../pages/website_page_screen.dart';
import 'order_verification_logic.dart';

/// Website `/whatsapp/orders`: orders customers placed on WhatsApp, waiting for the payment to be
/// checked. Approve makes the invoice; Reject cancels the order and tells the customer why.
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
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
      _notInPlan = false;
    });
    try {
      final body = await widget.session.api.getJson('/api/whatsapp/orders?status=draft');
      if (!mounted) return;
      setState(() {
        _rows = whatsAppOrderRows(body['orders']);
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _approve(WhatsAppOrderRow row) async {
    final ok = await showKSheet<bool>(
      context,
      title: 'Approve ${row.number}?',
      builder: (ctx) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('The payment is confirmed and an invoice for ${inr(row.total)} is created for ${row.customer}.', style: AppText.body),
          const SizedBox(height: AppSpace.md),
          KButton(label: 'Approve and create invoice', onPressed: () => Navigator.of(ctx).pop(true)),
        ]),
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy.add(row.id));
    try {
      final res = await widget.session.api.postJson('/api/whatsapp/orders/${row.id}/approve', const {});
      if (!mounted) return;
      final number = res['invoice_number']?.toString();
      _toast(number == null ? 'Order approved' : 'Approved · invoice $number created');
      await _load();
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } catch (_) {
      if (mounted) _toast('Could not approve. Try again.');
    } finally {
      if (mounted) setState(() => _busy.remove(row.id));
    }
  }

  Future<void> _reject(WhatsAppOrderRow row) async {
    final reason = await showReasonSheet(
      context,
      title: 'Reject ${row.number}?',
      confirmLabel: 'Reject order',
      hint: 'Payment could not be verified',
    );
    if (reason == null || !mounted) return;
    setState(() => _busy.add(row.id));
    try {
      await widget.session.api.postJson('/api/whatsapp/orders/${row.id}/reject', {
        if (reason.isNotEmpty) 'reason': reason,
      });
      if (!mounted) return;
      _toast('Order rejected');
      await _load();
    } on ApiException catch (e) {
      if (mounted) _toast(e.message);
    } catch (_) {
      if (mounted) _toast('Could not reject. Try again.');
    } finally {
      if (mounted) setState(() => _busy.remove(row.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(
              'Order Verification',
              trailing: KIconButton(
                icon: LucideIcons.globe,
                tooltip: 'Open on website',
                onTap: () => openWebsiteInApp(context, widget.session, '/whatsapp/orders', 'Order Verification'),
              ),
            ),
            Expanded(child: _body()),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
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
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          if (_rows.isEmpty)
            const KEmptyState(
              icon: LucideIcons.packageCheck,
              title: 'No orders to verify',
              body: 'Orders customers place on WhatsApp show up here until you check the payment.',
            )
          else
            for (final row in _rows) ...[
              _card(row),
              const SizedBox(height: AppSpace.sm),
            ],
        ],
      ),
    );
  }

  Widget _card(WhatsAppOrderRow row) {
    final busy = _busy.contains(row.id);
    return KCard(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(row.customer, style: AppText.body.copyWith(fontWeight: FontWeight.w600)),
                  Text(
                    [row.number, if (row.date != null) dMMM(row.date!), ?row.phone].join(' · '),
                    style: AppText.caption,
                  ),
                ]),
              ),
              KAmount(row.total, style: AppText.heading.copyWith(fontSize: 16)),
            ]),
            if (row.lines.isNotEmpty) ...[
              const SizedBox(height: 8),
              for (final line in row.lines.take(4)) Text(line, style: AppText.body.copyWith(color: AppColors.ink2)),
              if (row.lines.length > 4) Text('+${row.lines.length - 4} more', style: AppText.caption),
            ],
            if (row.paymentProofUrl != null) ...[
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: Image.network(
                  row.paymentProofUrl!,
                  height: 160,
                  width: double.infinity,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => Text('Payment screenshot could not be shown', style: AppText.caption),
                ),
              ),
            ],
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: KButton(label: 'Approve', height: 40, loading: busy, onPressed: busy ? null : () => _approve(row))),
              const SizedBox(width: AppSpace.sm),
              Expanded(child: KButton(label: 'Reject', height: 40, kind: KButtonKind.secondary, onPressed: busy ? null : () => _reject(row))),
            ]),
          ],
        ),
      ),
    );
  }
}
