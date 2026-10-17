import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import 'hub_common.dart';
import 'new_arrivals_screen.dart';
import 'supply_orders_screen.dart';

String _linkLabel(String status, {required bool vendorView}) => switch (status) {
      'approved' => vendorView ? 'Connected buyer on Khatario' : 'Connected on Khatario',
      'pending' => vendorView ? 'Asked to add you as supplier' : 'Waiting for the supplier to approve',
      'rejected' => 'Link declined',
      'disconnected' => 'Disconnected',
      _ => 'Not connected',
    };

KTone _linkTone(String status) => switch (status) {
      'approved' => KTone.positive,
      'pending' => KTone.due,
      'rejected' || 'disconnected' => KTone.negative,
      _ => KTone.neutral,
    };

Future<bool> _confirm(BuildContext context, String text, String yes) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      content: Text(text),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Back')),
        TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(yes)),
      ],
    ),
  );
  return ok == true;
}

/// On a supplier who is on Khatario: link status, stock sharing, orders and disconnect.
class HubSupplierLinkCard extends StatefulWidget {
  const HubSupplierLinkCard({super.key, required this.session, required this.supplierId, required this.supplierName});

  final AppSession session;
  final String supplierId;
  final String supplierName;

  @override
  State<HubSupplierLinkCard> createState() => _HubSupplierLinkCardState();
}

class _HubSupplierLinkCardState extends State<HubSupplierLinkCard> {
  Map<String, dynamic>? _link;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/suppliers/hub/link?supplier_id=${widget.supplierId}');
      if (mounted) setState(() => _link = body);
    } on ApiException {
      if (mounted) setState(() => _link = null);
    }
  }

  Future<void> _run(Future<void> Function() fn) async {
    setState(() => _busy = true);
    try {
      await fn();
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _share(bool on) => _run(() async {
        await widget.session.api.putJson('/api/suppliers/${widget.supplierId}', {
          'allow_low_stock_access': on,
          'updated_by_user_id': widget.session.user['id'],
        });
      });

  Future<void> _disconnect(bool pending) async {
    final ok = await _confirm(
      context,
      pending
          ? 'Withdraw the request to link with ${widget.supplierName}?'
          : 'Disconnect from ${widget.supplierName}? Past bills stay. New orders, low-stock alerts and bill imports stop.',
      pending ? 'Withdraw' : 'Disconnect',
    );
    if (!ok) return;
    await _run(() => widget.session.api.deleteJson('/api/suppliers/hub/link?supplier_id=${widget.supplierId}'));
  }

  Future<void> _reconnect() => _run(() async {
        await widget.session.api.postJson('/api/suppliers/hub/connection-requests', {
          'supplier_business_id': _link!['other_business_id'],
        });
        if (mounted) hubSnack(context, 'Request sent. The link goes live once the supplier accepts.');
      });

  @override
  Widget build(BuildContext context) {
    final link = _link;
    if (link == null) return const SizedBox.shrink();
    final status = link['status']?.toString() ?? 'none';
    final live = status == 'approved';
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const KSectionHeader('Supplier Hub'),
          KCard(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(children: [
                  KPill(label: _linkLabel(status, vendorView: false), tone: _linkTone(status)),
                  const Spacer(),
                  if (live || status == 'pending')
                    KTextButton(label: status == 'pending' ? 'Withdraw' : 'Disconnect', color: AppColors.negative, onTap: _busy ? () {} : () => _disconnect(status == 'pending')),
                  if (status == 'disconnected' || status == 'rejected')
                    KTextButton(label: 'Ask to reconnect', onTap: _busy ? () {} : _reconnect),
                ]),
                if (live) ...[
                  const SizedBox(height: AppSpace.sm),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    value: link['stock_shared'] == true,
                    onChanged: _busy ? null : _share,
                    title: Text('Share stock and sales with them', style: AppText.bodyStrong),
                    subtitle: Text(
                      'They are told when their items reach your reorder level and can propose an order. '
                      'Your sales of their items count in their area totals, never shown as your shop alone.',
                      style: AppText.caption,
                    ),
                  ),
                  const SizedBox(height: AppSpace.sm),
                  Row(children: [
                    Expanded(
                      child: KButton.secondary(
                        label: 'New arrivals',
                        icon: LucideIcons.sparkles,
                        height: 42,
                        onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => NewArrivalsScreen(session: widget.session, supplierId: widget.supplierId),
                        )),
                      ),
                    ),
                    const SizedBox(width: AppSpace.sm),
                    Expanded(
                      child: KButton(
                        label: 'New order',
                        icon: LucideIcons.packagePlus,
                        height: 42,
                        onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                          builder: (_) => NewSupplyOrderScreen(session: widget.session, supplierId: widget.supplierId, supplierName: widget.supplierName),
                        )),
                      ),
                    ),
                  ]),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// On a customer who is a connected buyer: link status, whether they share stock, and disconnect.
class HubCustomerLinkCard extends StatefulWidget {
  const HubCustomerLinkCard({super.key, required this.session, required this.customerId});

  final AppSession session;
  final String customerId;

  @override
  State<HubCustomerLinkCard> createState() => _HubCustomerLinkCardState();
}

class _HubCustomerLinkCardState extends State<HubCustomerLinkCard> {
  Map<String, dynamic>? _link;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/suppliers/hub/link?customer_id=${widget.customerId}');
      if (mounted) setState(() => _link = body);
    } on ApiException {
      if (mounted) setState(() => _link = null);
    }
  }

  Future<void> _disconnect() async {
    final ok = await _confirm(context, 'Disconnect this buyer? Past bills stay. New orders, low-stock alerts and bill imports stop.', 'Disconnect');
    if (!ok) return;
    setState(() => _busy = true);
    try {
      await widget.session.api.deleteJson('/api/suppliers/hub/link?customer_id=${widget.customerId}');
      await _load();
    } on ApiException catch (e) {
      if (mounted) hubSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final link = _link;
    final status = link?['status']?.toString() ?? 'none';
    if (link == null || status == 'none') return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const KSectionHeader('Supplier Hub'),
          KCard(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                KPill(label: _linkLabel(status, vendorView: true), tone: _linkTone(status)),
                const Spacer(),
                if (status == 'approved')
                  KTextButton(label: 'Disconnect', color: AppColors.negative, onTap: _busy ? () {} : _disconnect),
              ]),
              if (status == 'approved') ...[
                const SizedBox(height: AppSpace.sm),
                Text(link['stock_shared'] == true ? 'Shares stock and sales with you.' : 'Does not share stock and sales.', style: AppText.caption),
                const SizedBox(height: AppSpace.sm),
                KButton.secondary(
                  label: 'Orders with this buyer',
                  icon: LucideIcons.packageSearch,
                  height: 42,
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => SupplyOrdersScreen(session: widget.session, selling: true),
                  )),
                ),
              ],
            ]),
          ),
        ],
      ),
    );
  }
}
