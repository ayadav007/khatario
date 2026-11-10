import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../sales/doc_action_sheets.dart';
import 'adjustment_form_screen.dart';
import 'repack_form_screen.dart';
import 'stock_logic.dart';

/// `app/(app)/inventory-adjustments/page.tsx`: stock adjustments newest first (Type chips, search, paging) and,
/// beside them, the repacks. `GET /api/inventory-adjustments?adjustment_type=&page=` replies
/// `{ adjustments, pagination }`; `GET /api/inventory-adjustments/repacks?limit=200` replies `{ repacks }` in one piece.
class AdjustmentsScreen extends StatefulWidget {
  const AdjustmentsScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<AdjustmentsScreen> createState() => _AdjustmentsScreenState();
}

class _AdjustmentsScreenState extends State<AdjustmentsScreen> {
  bool _repacks = false;

  AppSession get _s => widget.session;

  Future<bool?> _openAdjustment(BuildContext context, Map<String, dynamic> row) async {
    // A repack leg is read and undone as a whole repack, as on the website.
    final repackId = adjustmentRepackId(row);
    final changed = await Navigator.of(context).push<bool>(MaterialPageRoute(
      builder: (_) => repackId != null ? RepackDetailScreen(session: _s, repackId: repackId) : AdjustmentDetailScreen(session: _s, seed: row),
    ));
    return changed == true;
  }

  Future<bool?> _openRepack(BuildContext context, Map<String, dynamic> row) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => RepackDetailScreen(session: _s, repackId: docText(row['id']))),
    );
    return changed == true;
  }

  DocListSpec get _adjustmentSpec => DocListSpec(
        title: 'Adjustments',
        href: '/inventory-adjustments',
        path: '/api/inventory-adjustments',
        listKey: 'adjustments',
        titleOf: adjustmentTitle,
        subtitleOf: adjustmentSubtitle,
        searchKeys: const ['adjustment_number', 'item_name', 'item_code', 'variant_name'],
        filters: kAdjustmentFilters,
        filterParam: 'adjustment_type',
        icon: LucideIcons.arrowUpDown,
        emptyTitle: 'No adjustments yet',
        emptyBody: 'Adjust stock up or down when a count, a breakage or a loss changes what you have.',
        createLabel: 'New adjustment',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => AdjustmentFormScreen(session: _s))),
        onOpen: _openAdjustment,
      );

  DocListSpec get _repackSpec => DocListSpec(
        title: 'Repacks',
        href: '/inventory-adjustments',
        path: '/api/inventory-adjustments/repacks?limit=200',
        listKey: 'repacks',
        titleOf: repackTitle,
        subtitleOf: repackSubtitle,
        statusOf: (r) => repackStatus(r) == 'cancelled' ? 'cancelled' : null,
        searchKeys: const ['repack_number', 'source_name', 'packed_name'],
        icon: LucideIcons.packageOpen,
        emptyTitle: 'No repacks yet',
        emptyBody: 'A repack takes stock out of a bulk item and puts it into your own packs.',
        createLabel: 'New repack',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => RepackFormScreen(session: _s))),
        onOpen: _openRepack,
        rowActions: (row) => [if (repackCanCancel(row)) _cancelAction(_s, row)],
      );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const KBackBar('Adjustments'),
            Padding(
              padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.sm),
              child: KSegmented<bool>(
                value: _repacks,
                options: const [(false, 'Adjustments'), (true, 'Repacks')],
                onChanged: (v) => setState(() => _repacks = v),
              ),
            ),
            Expanded(
              child: DocListScreen(
                key: ValueKey(_repacks),
                session: _s,
                spec: _repacks ? _repackSpec : _adjustmentSpec,
                embedded: true,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _unitText(dynamic v) => docText(v);

String _qty(dynamic v) {
  final n = docNum(v);
  return n == null ? '' : jsNumberString((n * 1000).round() / 1000);
}

String _withUnit(dynamic v, String unit) {
  final q = _qty(v);
  return q.isEmpty ? '' : (unit.isEmpty ? q : '$q $unit');
}

String _money(dynamic v) {
  final n = docNum(v);
  return n == null ? '' : inr(n, maxFraction: 2);
}

/// One stock adjustment: `GET /api/inventory-adjustments/[id]` (`{ adjustment }`). The before and after figures are
/// the server's own.
class AdjustmentDetailScreen extends StatelessWidget {
  const AdjustmentDetailScreen({super.key, required this.session, required this.seed});

  final AppSession session;
  final Map<String, dynamic> seed;

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final body = await api.getJson('/api/inventory-adjustments/${docText(seed['id'])}');
    final raw = body['adjustment'];
    if (raw is! Map) throw ApiException('Adjustment not found');
    return Map<String, dynamic>.from(raw);
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: seed,
      spec: DocDetailSpec(
        title: 'Adjustment',
        load: _load,
        numberOf: adjustmentTitle,
        partyOf: (d) {
          final variant = docText(d['variant_name']);
          final item = docText(d['item_name']);
          return variant.isEmpty ? item : '$item ($variant)';
        },
        facts: (d) {
          final date = docDate(d['adjustment_date']);
          final value = docText(d['adjustment_type']) == 'VALUE';
          final unit = _unitText(d['item_unit']);
          final dir = docText(d['direction']);
          final change = docNum(d['quantity_change']);
          final valueChange = docNum(d['value_change']);
          return [
            ('Date', date == null ? '' : ddMMMyyyy(date)),
            ('Type', value ? 'Value' : 'Quantity'),
            if (!value) ('Direction', dir == 'INCREASE' ? 'Stock added' : dir == 'DECREASE' ? 'Stock reduced' : ''),
            ('Item code', docText(d['item_code'])),
            ('Warehouse', docText(d['location_name'])),
            ('Reason', adjustmentReasonLabel(docText(d['reason_code']))),
            ('Reason notes', docText(d['reason_notes'])),
            ('Notes', docText(d['notes'])),
            if (!value && change != null) ('Quantity change', '${change > 0 ? '+' : ''}${_withUnit(change, unit)}'),
            if (value && valueChange != null) ('Value change', '${valueChange > 0 ? '+' : '-'}${_money(valueChange.abs())}'),
            ('GST impact', docNum(d['gst_impact']) == null || docNum(d['gst_impact']) == 0 ? '' : _money(d['gst_impact'])),
            ('Stock before', _withUnit(d['quantity_before'], unit)),
            ('Stock after', _withUnit(d['quantity_after'], unit)),
            ('Unit cost before', _money(d['unit_cost_before'])),
            ('Unit cost after', _money(d['unit_cost_after'])),
            ('Value before', _money(d['total_value_before'])),
            ('Value after', _money(d['total_value_after'])),
            ('Journal entry', docText(d['journal_entry_id'])),
            ('Added by', docText(d['created_by_name'])),
          ];
        },
      ),
    );
  }
}

/// One repack: `GET /api/inventory-adjustments/repacks/[id]` (`{ repack }`). Repack again and Cancel repack come from
/// the website's page.
class RepackDetailScreen extends StatelessWidget {
  const RepackDetailScreen({super.key, required this.session, required this.repackId});

  final AppSession session;
  final String repackId;

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final body = await api.getJson('/api/inventory-adjustments/repacks/$repackId');
    final raw = body['repack'];
    if (raw is! Map) throw ApiException('Repack not found');
    return Map<String, dynamic>.from(raw);
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      spec: DocDetailSpec(
        title: 'Repack',
        load: _load,
        numberOf: repackTitle,
        statusOf: (d) => repackStatus(d) == 'cancelled' ? 'cancelled' : '',
        facts: (d) {
          final date = docDate(d['repack_date']);
          final unit = _unitText(d['source_unit']);
          final wastage = docNum(d['wastage_qty']) ?? 0;
          final reason = docText(d['wastage_reason']);
          final notes = docText(d['wastage_notes']);
          final cancelled = repackStatus(d) == 'cancelled';
          final cost = docNum(d['total_cost']);
          final perPack = docNum(d['unit_cost']);
          return [
            ('Date', date == null ? '' : ddMMMyyyy(date)),
            ('Took out', '${_withUnit(d['source_qty'], unit)} ${docText(d['source_name'])}'.trim()),
            ('Made', '${_qty(d['packed_qty'])} ${docText(d['packed_name'])} (${_withUnit(d['content_per_unit'], unit.toLowerCase())} each)'),
            (
              'Wastage',
              wastage > 0
                  ? '${_withUnit(wastage, unit)}${reason.isEmpty ? '' : ' · ${wastageReasonLabel(reason)}'}${notes.isEmpty ? '' : ': $notes'}'
                  : 'None',
            ),
            ('Cost carried', cost == null ? '' : '${_money(cost)}${perPack == null ? '' : ' · ${_money(perPack)} per pack'}'),
            (docText(d['location_name']).isNotEmpty ? 'Warehouse' : 'Branch', docText(d['location_name']).isNotEmpty ? docText(d['location_name']) : docText(d['branch_name'])),
            ('Note', docText(d['notes'])),
            if (cancelled) ('Cancelled', 'Both items were put back'),
            ('By', docText(d['created_by_name'])),
          ];
        },
        primary: (d) => repackCanCancel(d)
            ? DocAction('Repack again', LucideIcons.packageOpen, (ctx) async {
                final saved = await Navigator.of(ctx).push<bool>(MaterialPageRoute(
                  builder: (_) => RepackFormScreen(session: session, initialItemId: docText(d['packed_item_id'])),
                ));
                return saved == true ? true : null;
              })
            : null,
        actions: (d) => [if (repackCanCancel(d)) _cancelAction(session, d)],
      ),
    );
  }
}

DocAction _cancelAction(AppSession session, Map<String, dynamic> repack) =>
    DocAction('Cancel repack', LucideIcons.circleX, (ctx) => cancelRepack(ctx, session.api, repack), danger: true);

/// A repack is cancelled at most once at a time.
final _inFlight = <String>{};

/// Asks first (it puts both items back), then `POST /api/inventory-adjustments/repacks/[id]/cancel` once.
/// True when the repack changed or the server says it is not as the phone showed it (409: reload). Null on no,
/// a repeat tap, or any other refusal (the server's words are a toast and nothing changed).
Future<bool?> cancelRepack(BuildContext context, KhatarioApi api, Map<String, dynamic> repack) async {
  final id = docText(repack['id']);
  if (!_inFlight.add(id)) return null;
  try {
    final ok = await askSheet(
      context,
      title: 'Cancel this repack?',
      text: repackCancelText(repack),
      confirmLabel: 'Cancel repack',
      cancelLabel: 'Keep repack',
    );
    if (!ok || !context.mounted) return null;
    await api.postJson('/api/inventory-adjustments/repacks/$id/cancel', const {});
    if (context.mounted) showKToast(context, '${repackTitle(repack)} cancelled; stock put back', tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
    return e.status == 409 ? true : null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not cancel the repack', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(id);
  }
}
