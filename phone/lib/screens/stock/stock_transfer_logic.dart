import '../../api.dart';
import '../../format.dart';
import '../docs/doc_logic.dart';

/// Stock transfers (`app/(app)/stock-transfers/**`).
///
/// `GET /api/stock-transfers` replies `{ transfers }` (rows are `st.*` plus `from_warehouse_name`, `to_warehouse_name`,
/// `approved_by_name`, `created_by_name`, `delivery_challan_id`, `delivery_challan_number`) in one piece, with no status
/// filter and no paging. There is no single-transfer route (F-019): the detail finds its transfer in that list and reads
/// the lines from `GET /api/stock-transfers/[id]/items` (`{ items }`: `sti.*` plus `item_name`, `unit`).
/// The phone shows the server's figures; stock is the server's job and the phone never works it out.

/// The website's status chips, in its order (`statusConfig`).
const kTransferFilters = <(String, String)>[
  ('', 'All'),
  ('draft', 'Draft'),
  ('pending_approval', 'Pending approval'),
  ('pending', 'Pending dispatch'),
  ('in_transit', 'In transit'),
  ('completed', 'Completed'),
  ('cancelled', 'Cancelled'),
];

String transferStatusLabel(String status) {
  for (final (value, label) in kTransferFilters) {
    if (value == status && value.isNotEmpty) return label;
  }
  if (status.isEmpty) return '';
  final words = status.replaceAll('_', ' ');
  return words[0].toUpperCase() + words.substring(1);
}

/// The key the shared status badge turns into the website's word: the badge says "Pending" for `pending`, the
/// website says "Pending Dispatch".
String transferStatusKey(String status) => status == 'pending' ? 'pending_dispatch' : status;

String transferStatusOf(Map<String, dynamic> row) => docText(row['status']);

bool transferMatchesFilter(Map<String, dynamic> row, String filter) => filter.isEmpty || transferStatusOf(row) == filter;

String transferTitle(Map<String, dynamic> row) {
  final n = docText(row['transfer_number']);
  return n.isEmpty ? 'Transfer' : n;
}

/// "Main godown → Back room · 05 Nov 2026".
String transferSubtitle(Map<String, dynamic> row) {
  final date = docDate(row['transfer_date']);
  final from = docText(row['from_warehouse_name']);
  final to = docText(row['to_warehouse_name']);
  return [
    if (from.isNotEmpty || to.isNotEmpty) '${from.isEmpty ? 'N/A' : from} → ${to.isEmpty ? 'N/A' : to}',
    if (date != null) ddMMMyyyy(date),
  ].join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

enum TransferAction { approve, dispatch, receive, closeShort, cancel }

/// What the website offers for each status: draft and pending approval → Approve and Cancel; pending dispatch →
/// Dispatch and Cancel; in transit → Receive and Close shortfall. Nothing once completed or cancelled.
List<TransferAction> transferActions(String status) {
  switch (status) {
    case 'draft':
    case 'pending_approval':
      return const [TransferAction.approve, TransferAction.cancel];
    case 'pending':
      return const [TransferAction.dispatch, TransferAction.cancel];
    case 'in_transit':
      return const [TransferAction.receive, TransferAction.closeShort];
  }
  return const [];
}

/// `POST .../approve`. The website also sends `approved_by` and `business_id`; the session names both.
Map<String, dynamic> approveBody() => <String, dynamic>{};

/// `PATCH .../dispatch`. The route reads an optional `dispatch_date` (today when absent); the website sends none.
Map<String, dynamic> dispatchBody() => <String, dynamic>{};

/// `PATCH .../cancel`. The website sends this fixed reason.
Map<String, dynamic> cancelBody() => {'cancellation_reason': 'Cancelled by user'};

const kDispatchQuestion = 'Stock will be deducted from the source warehouse.';

String dispatchText(Map<String, dynamic> row) => '$kDispatchQuestion Dispatch ${transferTitle(row)}?';

String cancelText(Map<String, dynamic> row) => 'Cancel ${transferTitle(row)}? It will not move any stock.';

/// The transfer changed under the phone: another device approved, dispatched, received or cancelled it. The server's
/// refusal is `TRANSFER_STATE_CHANGED` (409) or, for cancel, `INVALID_STATUS` (409); closing short says only that the
/// transfer is not in transit.
bool transferAlreadyChanged(ApiException e) {
  if (e.status != 409) return false;
  return e.code == 'TRANSFER_STATE_CHANGED' || e.code == 'INVALID_STATUS' || e.message.startsWith('Only a transfer in transit');
}

const kTransferChangedText = 'This transfer has already changed. Showing the latest.';

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

num _r3(num n) => (n * 1000).round() / 1000;

/// A positive number, or null (the website reads these as `a || b || 0`, so a zero falls through).
num? _positive(dynamic v) {
  final n = docNum(v);
  return n != null && n > 0 ? n : null;
}

/// What was sent: `quantity_dispatched`, else `quantity_requested`, else 0 (the website's receive page).
num transferDispatched(Map<String, dynamic> item) => _positive(item['quantity_dispatched']) ?? _positive(item['quantity_requested']) ?? 0;

num transferRequested(Map<String, dynamic> item) => _positive(item['quantity_requested']) ?? _positive(item['qty']) ?? 0;

num transferShort(Map<String, dynamic> item) => docNum(item['qty_short']) ?? 0;

String transferQty(num n) => jsNumberString(_r3(n));

/// The receive box starts at what is already received, else at what was sent less any written-off shortfall.
/// (The website starts at what was sent; the server refuses more than sent less the shortfall.)
num defaultReceivedQty(Map<String, dynamic> item) {
  final got = _positive(item['received_qty']);
  if (got != null) return got;
  final left = _r3(transferDispatched(item) - transferShort(item));
  return left > 0 ? left : 0;
}

/// What is still in transit: sent less received less written off (`open` in the website's shortfall panel).
num openShortQty(Map<String, dynamic> item) {
  final n = _r3((_positive(item['quantity_dispatched']) ?? 0) - (docNum(item['received_qty']) ?? 0) - transferShort(item));
  return n > 0 ? n : 0;
}

/// "Short" column of the website's items table: `2 (claimed from Speedy)` or `2 (transit loss)`; empty when none.
String transferShortText(Map<String, dynamic> item) {
  final short = transferShort(item);
  if (short <= 0) return '';
  final why = docText(item['short_reason']) == 'carrier_claim' ? 'claimed from ${docText(item['claim_party'])}' : 'transit loss';
  return '${transferQty(short)} ($why)';
}

String transferLineSubtitle(Map<String, dynamic> item) {
  final unit = docText(item['unit']).isEmpty ? 'PCS' : docText(item['unit']);
  final sent = _positive(item['quantity_dispatched']);
  final got = docNum(item['received_qty']);
  final short = transferShortText(item);
  return [
    'Requested ${transferQty(transferRequested(item))}',
    if (sent != null) 'Dispatched ${transferQty(sent)}',
    if (got != null) 'Received ${transferQty(got)}',
    if (short.isNotEmpty) 'Short $short',
    unit,
  ].join(' · ');
}

// ---------------------------------------------------------------------------------------------
// Receive
// ---------------------------------------------------------------------------------------------

/// `POST .../receive` body: `received_items` (per line `item_id`, `received_qty` and the old `qty`), `notes`.
/// `received_qty` is the cumulative total received so far; the server adds only the increase. The website also sends
/// `received_by` and `business_id`; the session names both.
Map<String, dynamic> receiveBody({required List<({String itemId, num qty})> lines, String notes = ''}) {
  final note = notes.trim();
  return {
    'received_items': [
      for (final l in lines) {'item_id': l.itemId, 'received_qty': l.qty, 'qty': l.qty},
    ],
    'notes': note.isEmpty ? null : note,
  };
}

/// What the website refuses before sending: more than was sent, or nothing. [byRowId] maps each line's row id to the
/// quantity typed. The server also refuses less than already received and more than sent less any written-off
/// shortfall; those come back as its own message.
String? receiveRefusal(List<Map<String, dynamic>> items, Map<String, num?> byRowId) {
  for (final item in items) {
    final received = byRowId[docText(item['id'])] ?? 0;
    final sent = transferDispatched(item);
    final name = docText(item['item_name']);
    if (received > sent) {
      return 'Cannot receive more than dispatched for item "$name". Dispatched: ${transferQty(sent)}, Received: ${transferQty(received)}';
    }
    if (received <= 0) return 'Received quantity must be greater than 0 for item "$name"';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Close shortfall
// ---------------------------------------------------------------------------------------------

const kShortReasons = <(String, String)>[
  ('transit_loss', 'Lost in transit'),
  ('carrier_claim', 'Lost; claimed from the carrier'),
];

/// `POST .../close-short` body `{ date, lines: [{ item_id, qty, reason, claim_party, claim_amount }] }`. Lines with no
/// quantity are left out; the carrier and the amount go only for a carrier claim. The website also sends `business_id`.
Map<String, dynamic> closeShortBody({
  required DateTime date,
  required List<({String itemId, num qty})> lines,
  required String reason,
  String carrier = '',
  String amount = '',
}) {
  final claim = reason == 'carrier_claim';
  final claimAmount = num.tryParse(amount.trim());
  return {
    'date': ymd(date),
    'lines': [
      for (final l in lines)
        if (l.qty > 0)
          {
            'item_id': l.itemId,
            'qty': l.qty,
            'reason': reason,
            'claim_party': claim ? carrier.trim() : null,
            'claim_amount': claim && claimAmount != null && claimAmount != 0 ? claimAmount : null,
          },
    ],
  };
}

String closeShortText(String name, num qty, String unit, String reason) {
  final what = reason == 'carrier_claim' ? 'lost and claimed from the carrier' : 'lost in transit';
  return 'Write off ${transferQty(qty)} ${unit.isEmpty ? 'PCS' : unit} of $name as $what? '
      'Their input tax credit is reversed and this cannot be undone.';
}

/// The question when several lines are written off together.
String closeShortManyText(int lines, String reason) {
  final what = reason == 'carrier_claim' ? 'lost and claimed from the carrier' : 'lost in transit';
  return 'Write off the quantities entered for $lines items as $what? '
      'Their input tax credit is reversed and this cannot be undone.';
}

// ---------------------------------------------------------------------------------------------
// New transfer
// ---------------------------------------------------------------------------------------------

/// `TRF-YYYYMMDD-001` (the website's number), counting on from the day's earlier transfers when there are some.
String nextTransferNumber(List<String> existing, DateTime date) {
  final prefix = 'TRF-${date.year}${date.month.toString().padLeft(2, '0')}${date.day.toString().padLeft(2, '0')}-';
  var top = 0;
  for (final n in existing) {
    if (!n.startsWith(prefix)) continue;
    final k = int.tryParse(n.substring(prefix.length));
    if (k != null && k > top) top = k;
  }
  return '$prefix${(top + 1).toString().padLeft(3, '0')}';
}

/// `POST /api/stock-transfers` body. [fromId] and [toId] are `warehouses` ids (the table the route checks them
/// against). The route names the business and the creator from the session.
Map<String, dynamic> createBody({
  required String number,
  required DateTime date,
  required String fromId,
  required String toId,
  String notes = '',
  required List<({String itemId, num qty, String unit, String notes})> lines,
}) {
  final note = notes.trim();
  return {
    'transfer_number': number.trim(),
    'transfer_date': ymd(date),
    'from_location_id': fromId,
    'to_location_id': toId,
    'notes': note.isEmpty ? null : note,
    'items': [
      for (final l in lines)
        {
          'item_id': l.itemId,
          'qty': l.qty,
          'unit': l.unit,
          'notes': l.notes.trim().isEmpty ? null : l.notes.trim(),
        },
    ],
  };
}

/// What the website refuses before sending.
String? createRefusal({required String fromId, required String toId, required List<({String itemId, num qty})> lines}) {
  if (fromId.isEmpty || toId.isEmpty) return 'Please select both source and destination warehouses';
  if (fromId == toId) return 'Source and destination warehouses cannot be the same';
  if (lines.isEmpty) return 'Please add at least one item to transfer';
  for (final l in lines) {
    if (l.itemId.isEmpty) return 'Please select an item for all rows';
    if (l.qty <= 0) return 'Quantity must be greater than 0';
  }
  return null;
}

/// Finds one transfer in the list reply, with its lines. Null when it is not there.
Map<String, dynamic>? findTransfer(dynamic listBody, String id) {
  for (final r in docRows(listBody, 'transfers')) {
    if (docText(r['id']) == id) return r;
  }
  return null;
}

/// The transfer and its lines, as the website's detail page loads them.
Future<Map<String, dynamic>> loadTransfer(KhatarioApi api, String id) async {
  final list = await api.getData('/api/stock-transfers');
  final transfer = findTransfer(list, id);
  if (transfer == null) throw ApiException('Transfer not found', status: 404);
  final body = await api.getJson('/api/stock-transfers/$id/items');
  return {...transfer, 'items': docRows(body, 'items')};
}
