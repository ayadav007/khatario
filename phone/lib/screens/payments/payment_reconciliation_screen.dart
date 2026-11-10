import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../pages/website_page_screen.dart';
import '../sales/doc_action_sheets.dart';
import '../sales/load_failed_view.dart';
import 'payment_reconciliation_logic.dart';

/// Website `/payments/reconciliation`: gateway transactions that need a decision.
///
/// Each action changes a money record, so each one asks first, names the payment and the amount, posts once,
/// and reloads. A refusal is the server's message and the screen stays as it was.
class PaymentReconciliationScreen extends StatefulWidget {
  const PaymentReconciliationScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<PaymentReconciliationScreen> createState() => _PaymentReconciliationScreenState();
}

class _PaymentReconciliationScreenState extends State<PaymentReconciliationScreen> {
  List<PaymentTx> _rows = const [];
  bool _loading = true;
  String? _error;
  bool _notInPlan = false;
  String _status = 'requires_review';
  String _provider = 'all';
  final _search = TextEditingController();
  final Set<String> _busy = {};

  /// Providers seen so far, so the filter does not lose a name once it narrows the list.
  final Set<String> _providers = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) {
      setState(() {
        _loading = true;
        _error = null;
        _notInPlan = false;
      });
    }
    try {
      final query = Uri(queryParameters: {
        'reconciliation': '1',
        if (_status != 'all') 'status': _status,
      }).query;
      final body = await widget.session.api.getJson('/api/payments?$query');
      if (!mounted) return;
      final rows = paymentTransactions(body['payment_transactions']);
      setState(() {
        _rows = rows;
        _providers.addAll(rows.map((r) => r.provider).where((p) => p.isNotEmpty));
        _loading = false;
        _error = null;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (quiet) {
        showKToast(context, e.message, tone: KTone.negative);
        return;
      }
      setState(() {
        _notInPlan = LoadFailedView.isPlanBlock(e);
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || quiet) return;
      setState(() { _error = 'Could not reach the server.'; _loading = false; });
    }
  }

  List<PaymentTx> get _shown {
    final q = _search.text.trim().toLowerCase();
    return [
      for (final r in _rows)
        if ((_provider == 'all' || r.provider.toLowerCase() == _provider.toLowerCase()) &&
            (q.isEmpty || [r.orderId, r.utr ?? '', r.providerPaymentId ?? ''].any((v) => v.toLowerCase().contains(q))))
          r,
    ];
  }

  /// Asks, naming the payment and amount; posts once; reloads. Nothing is posted on "Not now".
  Future<void> _act(PaymentTx tx, ReconAction action) async {
    if (_busy.contains(tx.id)) return;
    final ok = await askSheet(
      context,
      title: '${action.label}?',
      text: reconConfirmText(action, tx),
      confirmLabel: action.label,
      cancelLabel: 'Not now',
      danger: action == ReconAction.markFailed,
    );
    if (!ok || !mounted || !_busy.add(tx.id)) return;
    setState(() {});
    try {
      await widget.session.api.postJson('/api/payments/manual-action', manualActionBody(tx.id, action));
      if (!mounted) return;
      showKToast(context, 'Updated', tone: KTone.positive);
      _busy.remove(tx.id);
      await _load(quiet: true);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Action failed', tone: KTone.negative);
    } finally {
      _busy.remove(tx.id);
      if (mounted) setState(() {});
    }
  }

  Future<void> _details(PaymentTx tx) async {
    final action = await showKSheet<ReconAction>(
      context,
      title: 'Order ${tx.shortOrderId}',
      scrollable: true,
      builder: (ctx) => _DetailsSheet(tx: tx),
    );
    if (action != null && mounted) await _act(tx, action);
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
              'Payment reconciliation',
              trailing: KIconButton(
                icon: LucideIcons.globe,
                tooltip: 'Open on website',
                onTap: () => openWebsiteInApp(context, widget.session, '/payments/reconciliation', 'Payment reconciliation'),
              ),
            ),
            KChipBar<String>(
              value: _status,
              options: kReconStatusFilters,
              onChanged: (v) {
                if (v == _status) return;
                setState(() => _status = v);
                _load();
              },
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
        LoadFailedView(title: 'Could not load transactions', message: _error, notInPlan: _notInPlan, onRetry: _load),
      ]);
    }
    final shown = _shown;
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xl),
        children: [
          KSearchField(controller: _search, hint: 'Order ID, UTR, provider payment id', onChanged: (_) => setState(() {})),
          if (_providers.length > 1) ...[
            const SizedBox(height: AppSpace.sm),
            KChipBar<String>(
              value: _provider,
              padding: EdgeInsets.zero,
              options: [('all', 'All providers'), for (final p in _providers.toList()..sort()) (p, p)],
              onChanged: (v) => setState(() => _provider = v),
            ),
          ],
          const SizedBox(height: AppSpace.md),
          if (shown.isEmpty)
            const KEmptyState(icon: LucideIcons.landmark, title: 'No transactions found.')
          else
            for (final tx in shown) ...[
              _card(tx),
              const SizedBox(height: AppSpace.md),
            ],
        ],
      ),
    );
  }

  Widget _card(PaymentTx tx) {
    final busy = _busy.contains(tx.id);
    final actions = reconActions(tx.status);
    return KCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Only the facts open the details, so a tap on a busy button cannot fall through to them.
          InkWell(
            onTap: () => _details(tx),
            child: Padding(
              padding: EdgeInsets.fromLTRB(14, 12, 14, actions.isEmpty ? 12 : 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Expanded(child: Text(tx.amountText, style: AppText.body.copyWith(fontWeight: FontWeight.w600))),
                    KPill(label: tx.statusLabel, tone: _tone(tx.status)),
                  ]),
                  const SizedBox(height: 2),
                  Text([tx.provider, tx.method].where((s) => s.isNotEmpty).join(' · '), style: AppText.caption),
                  Text('Order ${tx.shortOrderId} · ${tx.reference}', style: AppText.caption),
                  if (tx.when != null) Text(ddMMMyyyyHm(tx.when!), style: AppText.caption),
                ],
              ),
            ),
          ),
          if (actions.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
              child: Row(children: [
                for (final (i, a) in actions.indexed) ...[
                  if (i > 0) const SizedBox(width: AppSpace.sm),
                  Expanded(
                    child: KButton(
                      label: a.label,
                      height: 40,
                      kind: a == ReconAction.markFailed ? KButtonKind.danger : (a == ReconAction.markPaid ? KButtonKind.primary : KButtonKind.secondary),
                      loading: busy,
                      onPressed: busy ? null : () => _act(tx, a),
                    ),
                  ),
                ],
              ]),
            ),
        ],
      ),
    );
  }
}

KTone _tone(String status) => switch (status) {
      'success' => KTone.positive,
      'failed' => KTone.negative,
      'requires_review' || 'pending' => KTone.due,
      _ => KTone.neutral,
    };

const _pretty = JsonEncoder.withIndent('  ');

String _json(Object? v) {
  try {
    return _pretty.convert(v);
  } catch (_) {
    return '$v';
  }
}

/// Transaction details: ids, times, the validation and the raw payload, with the same actions.
class _DetailsSheet extends StatelessWidget {
  const _DetailsSheet({required this.tx});

  final PaymentTx tx;

  @override
  Widget build(BuildContext context) {
    final actions = reconActions(tx.status);
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KInfoCard(title: 'Transaction', rows: [
            ('Status', tx.statusLabel),
            ('Amount', tx.amountText),
            ('Provider', [tx.provider, tx.method].where((s) => s.isNotEmpty).join(' · ')),
            ('Transaction ID', tx.id),
            ('Order ID', tx.orderId),
            ('Reference', tx.reference),
            if (tx.createdAt != null) ('Created', ddMMMyyyyHm(tx.createdAt!)),
            if (tx.updatedAt != null) ('Updated', ddMMMyyyyHm(tx.updatedAt!)),
          ]),
          if (actions.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            for (final a in actions) ...[
              KButton(
                label: a.label,
                kind: a == ReconAction.markFailed ? KButtonKind.danger : (a == ReconAction.markPaid ? KButtonKind.primary : KButtonKind.secondary),
                onPressed: () => Navigator.of(context).pop(a),
              ),
              const SizedBox(height: AppSpace.sm),
            ],
          ],
          const SizedBox(height: AppSpace.md),
          const KSectionHeader('Validation'),
          KCard(padding: const EdgeInsets.all(AppSpace.md), child: SelectableText(_json(tx.validation), style: AppText.caption)),
          const SizedBox(height: AppSpace.lg),
          const KSectionHeader('Raw payload'),
          KCard(padding: const EdgeInsets.all(AppSpace.md), child: SelectableText(_json(tx.rawPayload), style: AppText.caption)),
        ],
      ),
    );
  }
}
