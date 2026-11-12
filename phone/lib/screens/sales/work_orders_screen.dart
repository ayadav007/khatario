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
import 'doc_action_sheets.dart';
import 'quotation_convert.dart' show ConvertConfirmSheet;
import 'sales_orders_screen.dart' show openInvoice;
import 'work_order_logic.dart';

/// `app/(app)/work-orders/page.tsx`: work orders newest first with the website's status chips.
/// `GET /api/work-orders?status=` replies `{ workOrders }` in one piece (the route does not page).
/// Open shows the work order; long-press offers the actions that fit its status.
class WorkOrdersScreen extends StatelessWidget {
  const WorkOrdersScreen({super.key, required this.session});

  final AppSession session;

  /// The work order page. The list reloads when it closes with a change.
  Future<bool?> _open(BuildContext context, Map<String, dynamic> row) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => WorkOrderDetailScreen(session: session, seed: row)),
    );
    return changed == true;
  }

  @override
  Widget build(BuildContext context) {
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Work orders',
        href: '/work-orders',
        path: '/api/work-orders',
        listKey: 'workOrders',
        titleOf: workOrderTitle,
        subtitleOf: workOrderSubtitle,
        amountOf: (r) => docNum(r['total_cost']),
        statusOf: workOrderStatus,
        searchKeys: const ['work_order_number', 'customer_name', 'work_description', 'assigned_to'],
        filters: kWorkOrderFilters,
        icon: LucideIcons.wrench,
        emptyTitle: 'No work orders yet',
        emptyBody: 'Work orders track services, jobs and maintenance for customers. Raise an invoice from one when the work is done.',
        createLabel: 'New work order',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(
          MaterialPageRoute(builder: (_) => BillFormScreen(session: session, kind: BillKind.workOrder)),
        ),
        onOpen: _open,
        rowActions: (row) => [for (final a in workOrderActions(row)) _action(session, row, a)],
      ),
    );
  }
}

DocAction _action(AppSession session, Map<String, dynamic> doc, WorkOrderAction a) {
  return switch (a) {
    WorkOrderAction.start => DocAction('Start work', LucideIcons.play, (ctx) => changeWorkOrderStatus(ctx, session.api, doc, 'in_progress')),
    WorkOrderAction.complete => DocAction('Mark completed', LucideIcons.circleCheck, (ctx) => changeWorkOrderStatus(ctx, session.api, doc, 'completed')),
    WorkOrderAction.createInvoice => DocAction('Create invoice', LucideIcons.receipt, (ctx) => convertWorkOrder(ctx, session, doc)),
    WorkOrderAction.schedule => DocAction('Schedule', LucideIcons.calendarCheck, (ctx) => changeWorkOrderStatus(ctx, session.api, doc, 'scheduled')),
    WorkOrderAction.openInvoice => DocAction(
        workOrderInvoiceCancelled(doc) ? 'Cancelled invoice' : 'View invoice',
        LucideIcons.externalLink,
        (ctx) => openInvoice(ctx, session, docText(doc['converted_invoice_id'])),
      ),
    WorkOrderAction.edit => DocAction('Edit', LucideIcons.pencil, (ctx) => _edit(ctx, session, doc)),
    WorkOrderAction.cancel => DocAction('Cancel work order', LucideIcons.circleX, (ctx) => changeWorkOrderStatus(ctx, session.api, doc, 'cancelled'), danger: true),
    WorkOrderAction.share => DocAction('Share', LucideIcons.share2, (ctx) => shareWorkOrder(ctx, session, doc)),
  };
}

Future<bool?> _edit(BuildContext context, AppSession session, Map<String, dynamic> doc) async {
  final saved = await Navigator.of(context).push<bool>(
    MaterialPageRoute(builder: (_) => BillFormScreen(session: session, kind: BillKind.workOrder, workOrderId: docText(doc['id']))),
  );
  return saved == true ? true : null;
}

/// A change of one work order runs at most once at a time.
final _inFlight = <String>{};

/// Asks where the website asks (Cancel; the hours on Mark completed), then `PATCH /api/work-orders/[id]` once
/// with `{ status, actual_hours }`. True when the work order changed or the server says it is not as the phone
/// showed it (a 409: reload). Null on no, a repeat tap, or any other refusal (its message is a toast).
Future<bool?> changeWorkOrderStatus(BuildContext context, KhatarioApi api, Map<String, dynamic> doc, String next) async {
  final id = docText(doc['id']);
  if (!_inFlight.add(id)) return null;
  try {
    num? hours;
    if (next == 'cancelled') {
      final ok = await askSheet(
        context,
        title: 'Cancel this work order?',
        text: workOrderCancelText(workOrderTitle(doc)),
        confirmLabel: 'Cancel work order',
        cancelLabel: 'Keep work order',
      );
      if (!ok || !context.mounted) return null;
    } else if (next == 'completed') {
      final answer = await askActualHours(context, current: docNum(doc['actual_hours']));
      if (answer == null || !context.mounted) return null;
      hours = answer.hours;
    }
    await api.patchJson('/api/work-orders/$id', workOrderStatusBody(next, hours: hours));
    if (context.mounted) showKToast(context, workOrderStatusToast(next), tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return e.status == 409 ? true : null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not update the work order', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(id);
  }
}

/// Asks, then `POST /api/work-orders/[id]/convert` once with `{}` (an invoice dated today; materials become item
/// lines and stock is issued, labour and other charges become service lines). The reply is
/// `{ invoice: { id, invoice_number }, work_order_id }`. The invoice opens, and True makes the caller reload.
/// A 409 ("already raised", "not completed") shows the server message and reloads. Null on no, a repeat tap or
/// any other refusal.
Future<bool?> convertWorkOrder(BuildContext context, AppSession session, Map<String, dynamic> doc) async {
  final id = docText(doc['id']);
  if (!_inFlight.add('convert:$id')) return null;
  try {
    final ok = await showKSheet<bool>(
      context,
      title: 'Create invoice?',
      builder: (ctx) => ConvertConfirmSheet(text: workOrderConvertText(workOrderTitle(doc), docNum(doc['total_cost']) ?? 0)),
    );
    if (ok != true || !context.mounted) return null;
    showKToast(context, 'Creating invoice...');
    final reply = await session.api.postJson('/api/work-orders/$id/convert', const {});
    final invoice = reply['invoice'];
    final invoiceId = invoice is Map ? docText(invoice['id']) : '';
    final invoiceNo = invoice is Map ? docText(invoice['invoice_number']) : '';
    if (context.mounted) {
      showKToast(
        context,
        invoiceNo.isEmpty ? 'Invoice created' : 'Invoice $invoiceNo created',
        tone: KTone.positive,
      );
    }
    if (invoiceId.isNotEmpty && context.mounted) await openInvoice(context, session, invoiceId);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return e.status == 409 ? true : null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not reach the server.', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove('convert:$id');
  }
}

/// Shares the work order's PDF (`GET /api/documents/work_orders/[id]/pdf`, the website's Print and PDF).
Future<bool?> shareWorkOrder(BuildContext context, AppSession session, Map<String, dynamic> doc) {
  final number = workOrderTitle(doc);
  return shareDocumentPdf(
    context,
    session,
    table: 'work_orders',
    id: docText(doc['id']),
    number: number,
    filePrefix: 'WorkOrder',
    subject: 'Work order $number',
  );
}

/// The work order page: `GET /api/work-orders/[id]` (`{ workOrder, items }`). The next step of the job is the
/// main action; Schedule, Edit, View invoice, Cancel and Share are under More.
class WorkOrderDetailScreen extends StatelessWidget {
  const WorkOrderDetailScreen({super.key, required this.session, this.seed, this.workOrderId});

  final AppSession session;
  final Map<String, dynamic>? seed;
  final String? workOrderId;

  String get _id => workOrderId ?? docText(seed?['id']);

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final body = await api.getJson('/api/work-orders/$_id');
    final raw = body['workOrder'];
    if (raw is! Map) throw ApiException('Work order not found');
    final doc = Map<String, dynamic>.from(raw);
    doc['items'] = docRows(body, 'items');
    return doc;
  }

  static String _day(dynamic v) {
    final d = docDate(v);
    return d == null ? '' : ddMMMyyyy(d);
  }

  static String _hours(dynamic v) {
    final n = docNum(v);
    return n == null ? '' : '${jsNumberString(n)} h';
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: seed,
      spec: DocDetailSpec(
        title: 'Work order',
        load: _load,
        numberOf: workOrderTitle,
        statusOf: workOrderStatus,
        partyOf: (d) => docText(d['customer_name']),
        amountOf: (d) => docNum(d['total_cost']),
        facts: (d) {
          final priority = docText(d['priority']);
          final invoice = docText(d['converted_invoice_number']);
          return [
            ('Work order date', _day(d['work_order_date'])),
            ('Priority', priority.isEmpty ? '' : priority[0].toUpperCase() + priority.substring(1)),
            ('Assigned to', docText(d['assigned_to'])),
            ('Description', docText(d['work_description'])),
            ('Location', docText(d['work_location'])),
            ('Scheduled start', _day(d['scheduled_start_date'])),
            ('Scheduled end', _day(d['scheduled_end_date'])),
            ('Started', _day(d['actual_start_date'])),
            ('Finished', _day(d['actual_end_date'])),
            ('Estimated hours', _hours(d['estimated_hours'])),
            ('Actual hours', _hours(d['actual_hours'])),
            ('Invoice', invoice.isEmpty ? '' : '$invoice${workOrderInvoiceCancelled(d) ? ' (cancelled)' : ''}'),
            ('Notes', docText(d['notes'])),
          ];
        },
        lines: (d) => [
          for (final l in docRows(d, 'items'))
            DocLine(
              docText(l['item_name']).isEmpty ? 'Item' : docText(l['item_name']),
              subtitle: workOrderLineSubtitle(l),
              amount: docNum(l['total_cost']),
            ),
        ],
        totals: (d) {
          num? shown(String key) {
            final v = docNum(d[key]);
            return v == null || v.abs() < 0.0001 ? null : v;
          }

          return [
            ('Materials', shown('material_cost')),
            ('Labour', shown('labor_cost')),
            ('Other charges', shown('other_cost')),
            ('Estimated total (before GST)', docNum(d['total_cost'])),
          ];
        },
        primary: (d) {
          final p = workOrderPrimary(d);
          return p == null ? null : _action(session, d, p);
        },
        actions: (d) {
          final p = workOrderPrimary(d);
          return [for (final a in workOrderActions(d)) if (a != p) _action(session, d, a)];
        },
      ),
    );
  }
}
