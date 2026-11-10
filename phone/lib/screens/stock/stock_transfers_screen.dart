import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/toast.dart';
import '../../ui/kit.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'stock_transfer_form_screen.dart';
import 'stock_transfer_logic.dart';
import 'stock_transfer_receive_screen.dart';

/// `app/(app)/stock-transfers/page.tsx`: stock moved between warehouses, newest first, with the website's status
/// chips. `GET /api/stock-transfers` replies `{ transfers }` in one piece (no paging, no status filter), so the chips
/// filter on the phone.
class StockTransfersScreen extends StatelessWidget {
  const StockTransfersScreen({super.key, required this.session});

  final AppSession session;

  Future<bool?> _open(BuildContext context, Map<String, dynamic> row) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => StockTransferDetailScreen(session: session, seed: row)),
    );
    return changed == true;
  }

  @override
  Widget build(BuildContext context) {
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Stock transfers',
        href: '/stock-transfers',
        path: '/api/stock-transfers',
        listKey: 'transfers',
        titleOf: transferTitle,
        subtitleOf: transferSubtitle,
        statusOf: (r) => transferStatusKey(transferStatusOf(r)),
        searchKeys: const ['transfer_number', 'from_warehouse_name', 'to_warehouse_name'],
        filters: kTransferFilters,
        filterRow: transferMatchesFilter,
        icon: LucideIcons.truck,
        emptyTitle: 'No stock transfers yet',
        emptyBody: 'Move stock from one warehouse to another and follow it until it arrives.',
        createLabel: 'New transfer',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => StockTransferFormScreen(session: session))),
        onOpen: _open,
      ),
    );
  }
}

/// `app/(app)/stock-transfers/[id]/page.tsx`: one transfer with its lines and the actions its status allows.
/// There is no single-transfer route (F-019), so the transfer comes from the list and the lines from
/// `GET /api/stock-transfers/[id]/items`. Pops with true when an action changed it.
class StockTransferDetailScreen extends StatelessWidget {
  const StockTransferDetailScreen({super.key, required this.session, required this.seed});

  final AppSession session;
  final Map<String, dynamic> seed;

  Future<Map<String, dynamic>> _load(KhatarioApi api) => loadTransfer(api, docText(seed['id']));

  DocAction _action(Map<String, dynamic> d, TransferAction a) {
    switch (a) {
      case TransferAction.approve:
        return DocAction('Approve', LucideIcons.circleCheck, (ctx) => runTransferAction(ctx, session.api, d, a));
      case TransferAction.dispatch:
        return DocAction('Dispatch', LucideIcons.truck, (ctx) => runTransferAction(ctx, session.api, d, a));
      case TransferAction.receive:
        return DocAction('Receive', LucideIcons.packageCheck, (ctx) async {
          final saved = await Navigator.of(ctx).push<bool>(
            MaterialPageRoute(builder: (_) => StockTransferReceiveScreen(session: session, transfer: d)),
          );
          return saved == true ? true : null;
        });
      case TransferAction.closeShort:
        return DocAction('Close shortfall', LucideIcons.packageX, (ctx) async {
          final saved = await Navigator.of(ctx).push<bool>(
            MaterialPageRoute(builder: (_) => StockTransferCloseShortScreen(session: session, transfer: d)),
          );
          return saved == true ? true : null;
        });
      case TransferAction.cancel:
        return DocAction('Cancel transfer', LucideIcons.circleX, (ctx) => runTransferAction(ctx, session.api, d, a), danger: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: seed,
      spec: DocDetailSpec(
        title: 'Stock transfer',
        load: _load,
        numberOf: transferTitle,
        statusOf: (d) => transferStatusKey(transferStatusOf(d)),
        partyOf: (d) => '${docText(d['from_warehouse_name'])} → ${docText(d['to_warehouse_name'])}',
        facts: (d) {
          final date = docDate(d['transfer_date']);
          final created = docDate(d['created_at']);
          final approvedAt = docDate(d['approved_at']);
          final by = docText(d['created_by_name']);
          final challan = docText(d['delivery_challan_id']).isEmpty
              ? ''
              : (docText(d['delivery_challan_number']).isEmpty ? 'Delivery challan' : docText(d['delivery_challan_number']));
          return [
            ('Transfer date', date == null ? '' : ddMMMyyyy(date)),
            ('From warehouse', docText(d['from_warehouse_name'])),
            ('To warehouse', docText(d['to_warehouse_name'])),
            ('Created', [if (created != null) ddMMMyyyy(created), if (by.isNotEmpty) 'by $by'].join(' ')),
            ('Approved by', docText(d['approved_by_name'])),
            ('Approved at', approvedAt == null ? '' : ddMMMyyyyHm(approvedAt)),
            ('Delivery challan', challan),
            ('Notes', docText(d['notes'])),
          ];
        },
        lines: (d) => [
          for (final i in docRows(d, 'items')) DocLine(docText(i['item_name']).isEmpty ? 'N/A' : docText(i['item_name']), subtitle: transferLineSubtitle(i)),
        ],
        primary: (d) {
          final actions = transferActions(transferStatusOf(d));
          return actions.isEmpty ? null : _action(d, actions.first);
        },
        actions: (d) => [for (final a in transferActions(transferStatusOf(d)).skip(1)) _action(d, a)],
      ),
    );
  }
}

/// One action at a time per transfer.
final _inFlight = <String>{};

/// Approve, Dispatch or Cancel one transfer. Dispatch and Cancel ask first (Dispatch takes stock out of the source
/// warehouse). True when the transfer changed, or when the server says it already had (reload either way); null on
/// no, a repeat tap, or any other refusal (the server's words are a toast and nothing changed).
Future<bool?> runTransferAction(BuildContext context, KhatarioApi api, Map<String, dynamic> transfer, TransferAction action) async {
  final id = docText(transfer['id']);
  if (!_inFlight.add(id)) return null;
  try {
    final name = transferTitle(transfer);
    switch (action) {
      case TransferAction.dispatch:
        final ok = await askSheet(context, title: 'Dispatch this transfer?', text: dispatchText(transfer), confirmLabel: 'Dispatch', cancelLabel: 'Not yet', danger: false);
        if (!ok || !context.mounted) return null;
        await api.patchJson('/api/stock-transfers/$id/dispatch', dispatchBody());
        if (context.mounted) showKToast(context, '$name dispatched', tone: KTone.positive);
      case TransferAction.cancel:
        final ok = await askSheet(context, title: 'Cancel this transfer?', text: cancelText(transfer), confirmLabel: 'Cancel transfer', cancelLabel: 'Keep transfer');
        if (!ok || !context.mounted) return null;
        await api.patchJson('/api/stock-transfers/$id/cancel', cancelBody());
        if (context.mounted) showKToast(context, '$name cancelled', tone: KTone.positive);
      case TransferAction.approve:
        await api.postJson('/api/stock-transfers/$id/approve', approveBody());
        if (context.mounted) showKToast(context, '$name approved', tone: KTone.positive);
      case TransferAction.receive:
      case TransferAction.closeShort:
        return null;
    }
    return true;
  } on ApiException catch (e) {
    if (transferAlreadyChanged(e)) {
      if (context.mounted) showKToast(context, kTransferChangedText);
      return true;
    }
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not reach the server. Try again.', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(id);
  }
}
