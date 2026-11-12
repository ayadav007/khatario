import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../purchases/bill_form_screen.dart';
import 'challan_logic.dart';
import 'doc_action_sheets.dart';
import 'sales_orders_screen.dart' show openInvoice;

/// `app/(app)/delivery-challans/page.tsx`: challans newest first with the website's status chips.
/// `GET /api/delivery-challans?status=` replies `{ deliveryChallans }` in one piece (the route does not page).
/// Open shows the challan; long-press offers the actions that fit its status.
class DeliveryChallansScreen extends StatelessWidget {
  const DeliveryChallansScreen({super.key, required this.session});

  final AppSession session;

  /// The challan page. The list reloads when it closes with a change.
  Future<bool?> _open(BuildContext context, Map<String, dynamic> row) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => DeliveryChallanDetailScreen(session: session, seed: row)),
    );
    return changed == true;
  }

  @override
  Widget build(BuildContext context) {
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Delivery challans',
        href: '/delivery-challans',
        path: '/api/delivery-challans',
        listKey: 'deliveryChallans',
        titleOf: challanTitle,
        subtitleOf: challanSubtitle,
        amountOf: challanAmount,
        statusOf: challanStatus,
        searchKeys: const ['challan_number', 'customer_name', 'vehicle_number', 'invoice_number', 'sales_order_number'],
        filters: kChallanFilters,
        icon: LucideIcons.truck,
        emptyTitle: 'No delivery challans yet',
        emptyBody: 'Delivery challans are shipping documents for goods you dispatch. They can be linked to invoices or sales orders.',
        createLabel: 'New delivery challan',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(
          MaterialPageRoute(builder: (_) => BillFormScreen(session: session, kind: BillKind.deliveryChallan)),
        ),
        onOpen: _open,
        rowActions: (row) => [for (final a in challanActions(row)) _action(session, row, a)],
      ),
    );
  }
}

DocAction _action(AppSession session, Map<String, dynamic> doc, ChallanAction a) {
  return switch (a) {
    ChallanAction.generate => DocAction('Generate', LucideIcons.send, (ctx) => changeChallanStatus(ctx, session.api, doc, 'sent')),
    ChallanAction.sendOut => DocAction('Send goods out', LucideIcons.send, (ctx) => changeChallanStatus(ctx, session.api, doc, 'sent')),
    ChallanAction.recordReturn => DocAction('Record return', LucideIcons.packageCheck, (ctx) => recordChallanReturn(ctx, session, doc)),
    ChallanAction.markDelivered => DocAction('Mark delivered', LucideIcons.circleCheck, (ctx) => changeChallanStatus(ctx, session.api, doc, 'delivered')),
    ChallanAction.edit => DocAction('Edit', LucideIcons.pencil, (ctx) => _edit(ctx, session, doc)),
    ChallanAction.openInvoice => DocAction('Open invoice', LucideIcons.externalLink, (ctx) => openInvoice(ctx, session, docText(doc['invoice_id']))),
    ChallanAction.cancel => DocAction('Cancel challan', LucideIcons.circleX, (ctx) => changeChallanStatus(ctx, session.api, doc, 'cancelled'), danger: true),
    ChallanAction.share => DocAction('Share', LucideIcons.share2, (ctx) => shareChallan(ctx, session, doc)),
  };
}

Future<bool?> _edit(BuildContext context, AppSession session, Map<String, dynamic> doc) async {
  final saved = await Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => BillFormScreen(session: session, kind: BillKind.deliveryChallan, challanId: docText(doc['id']))),
  );
  return saved == true ? true : null;
}

/// A change of one challan runs at most once at a time.
final _inFlight = <String>{};

/// Asks (for Cancel), then `PATCH /api/delivery-challans/[id]` with `{ status }` once. True when the challan
/// changed or the server says it is not as the phone showed it (a 409: reload). Null on no, a repeat tap, or
/// any other refusal (its message is a toast and nothing changed).
Future<bool?> changeChallanStatus(BuildContext context, KhatarioApi api, Map<String, dynamic> doc, String next) async {
  final id = docText(doc['id']);
  if (!_inFlight.add(id)) return null;
  try {
    if (next == 'cancelled') {
      final ok = await askSheet(
        context,
        title: 'Cancel this delivery challan?',
        text: challanCancelText(challanTitle(doc)),
        confirmLabel: 'Cancel challan',
        cancelLabel: 'Keep challan',
      );
      if (!ok || !context.mounted) return null;
    }
    await api.patchJson('/api/delivery-challans/$id', challanStatusBody(next));
    if (context.mounted) showKToast(context, challanStatusToast(next, returnable: isReturnableChallan(doc)), tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return e.status == 409 ? true : null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not update the challan', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(id);
  }
}

/// The website's "Record goods coming back": asks what came back, then `POST /api/delivery-challans/[id]/settle`
/// once. The challan page already carries its lines in `items`; from the list they are fetched first.
/// True when the return was recorded or the server says the challan moved on (409: reload).
Future<bool?> recordChallanReturn(BuildContext context, AppSession session, Map<String, dynamic> doc) async {
  final id = docText(doc['id']);
  if (!_inFlight.add('return:$id')) return null;
  try {
    var fresh = doc;
    var items = doc['items'] is List ? docRows(doc, 'items') : null;
    if (items == null) {
      final body = await session.api.getJson('/api/delivery-challans/$id');
      items = docRows(body, 'items');
      final raw = body['deliveryChallan'];
      if (raw is Map) fresh = Map<String, dynamic>.from(raw);
    }
    if (!context.mounted) return null;
    final purpose = docText(fresh['purpose']);
    final payload = await showKSheet<Map<String, dynamic>>(
      context,
      title: 'Goods coming back',
      scrollable: true,
      builder: (ctx) => ChallanReturnSheet(
        lines: challanOpenLines(items!),
        canSell: purpose == 'approval' || purpose == 'consignment',
        challanDate: docDate(fresh['challan_date']),
      ),
    );
    if (payload == null || !context.mounted) return null;
    final reply = await session.api.postJson('/api/delivery-challans/$id/settle', payload);
    if (context.mounted) {
      showKToast(context, reply['closed'] == true ? 'All goods are back; challan closed' : 'Return recorded', tone: KTone.positive);
    }
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return e.status == 409 ? true : null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not record the return', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove('return:$id');
  }
}

/// Shares the challan's PDF (`GET /api/documents/delivery_challans/[id]/pdf`, the website's Print and PDF).
Future<bool?> shareChallan(BuildContext context, AppSession session, Map<String, dynamic> doc) {
  final number = challanTitle(doc);
  return shareDocumentPdf(
    context,
    session,
    table: 'delivery_challans',
    id: docText(doc['id']),
    number: number,
    filePrefix: 'DeliveryChallan',
    subject: 'Delivery challan $number',
  );
}

/// The challan page: `GET /api/delivery-challans/[id]` (`{ deliveryChallan, items }`). The status move is the
/// main action; Edit, Cancel, Open invoice and Share are under More.
class DeliveryChallanDetailScreen extends StatelessWidget {
  const DeliveryChallanDetailScreen({super.key, required this.session, this.seed, this.challanId});

  final AppSession session;
  final Map<String, dynamic>? seed;
  final String? challanId;

  String get _id => challanId ?? docText(seed?['id']);

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final body = await api.getJson('/api/delivery-challans/$_id');
    final raw = body['deliveryChallan'];
    if (raw is! Map) throw ApiException('Delivery challan not found');
    final doc = Map<String, dynamic>.from(raw);
    doc['items'] = docRows(body, 'items');
    return doc;
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: seed,
      spec: DocDetailSpec(
        title: 'Delivery challan',
        load: _load,
        numberOf: challanTitle,
        statusOf: challanStatus,
        partyOf: challanParty,
        amountOf: challanAmount,
        facts: (d) {
          final date = docDate(d['challan_date']);
          final delivery = docDate(d['delivery_date']);
          final reason = docText(d['reason_for_transportation']);
          return [
            ('Challan date', date == null ? '' : ddMMMyyyy(date)),
            ('Delivery date', delivery == null ? '' : ddMMMyyyy(delivery)),
            ('Goods', challanReturnableNote(d)),
            ('Held by', docText(d['supplier_name'])),
            ('Godown', docText(d['warehouse_name'])),
            ('Reason', kChallanReasons[reason] ?? reason),
            ('Vehicle', docText(d['vehicle_number'])),
            ('Transporter', docText(d['transporter_name'])),
            ('Transporter GSTIN', docText(d['transporter_gstin'])),
            ('E-way bill', docText(d['e_way_bill_number'])),
            ('Place of delivery', docText(d['place_of_delivery'])),
            ('Shipping address', docText(d['shipping_address'])),
            ('Notes', docText(d['notes'])),
          ];
        },
        lines: (d) => [
          for (final l in docRows(d, 'items'))
            DocLine(
              docText(l['item_name']).isEmpty ? 'Item' : docText(l['item_name']),
              subtitle: challanLineSubtitle(l),
              amount: docNum(l['line_total']),
            ),
        ],
        totals: (d) {
          num? shown(String key) {
            final v = docNum(d[key]);
            return v == null || v.abs() < 0.0001 ? null : v;
          }

          return [
            ('Taxable value', docNum(d['subtotal'])),
            ('CGST', shown('cgst_total')),
            ('SGST', shown('sgst_total')),
            ('IGST', shown('igst_total')),
            ('Value of goods', docNum(d['grand_total'])),
          ];
        },
        primary: (d) {
          final p = challanPrimary(d);
          return p == null ? null : _action(session, d, p);
        },
        actions: (d) {
          final p = challanPrimary(d);
          return [for (final a in challanActions(d)) if (a != p) _action(session, d, a)];
        },
      ),
    );
  }
}
