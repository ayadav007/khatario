import '../../api.dart';
import '../../format.dart';
import '../docs/doc_logic.dart';

/// Stock counts (`app/(app)/stock-counts/**`).
/// `GET /api/stock-counts` replies `{ counts }` (`id`, `count_number`, `count_date`, `status`, `blind`, `freeze_stock`,
/// `warehouse_name`, `branch_name`, `lines`, `counted`; newest first, up to 200, no paging, no status filter).
/// `GET /api/stock-counts/[id]` replies the reconciliation (`count`, `blind`, `lines`, `with_third_party`, `in_transit`,
/// `held`, `others_goods`, `units`, `summary`, `classes`). `PATCH` takes `{ action: count | submit | reasons | post |
/// cancel, ... }`. `GET .../barcodes` replies `{ barcodes: { code: { item_id, qty, label } } }`.
/// The phone shows what the server returns; it never works out book stock, cost or a difference.

/// The website's list has no filter; the phone adds status chips, applied on the phone.
const kCountFilters = <(String, String)>[
  ('', 'All'),
  ('counting', 'Counting'),
  ('review', 'In review'),
  ('posted', 'Posted'),
  ('cancelled', 'Cancelled'),
];

String countStatusLabel(String status) => switch (status) {
      'counting' => 'Counting',
      'review' => 'In review',
      'posted' => 'Posted',
      'cancelled' => 'Cancelled',
      _ => status.isEmpty ? '' : status[0].toUpperCase() + status.substring(1).replaceAll('_', ' '),
    };

bool countMatchesFilter(Map<String, dynamic> row, String filter) => filter.isEmpty || docText(row['status']) == filter;

String countTitle(Map<String, dynamic> row) {
  final n = docText(row['count_number']);
  return n.isEmpty ? 'Stock count' : n;
}

bool _open(String status) => status == 'counting' || status == 'review';

/// "Counting, stock frozen · Main godown · 3 of 12 counted · 05 Nov 2026".
String countSubtitle(Map<String, dynamic> row) {
  final status = docText(row['status']);
  final frozen = row['freeze_stock'] == true && _open(status);
  final godown = docText(row['warehouse_name']).isNotEmpty ? docText(row['warehouse_name']) : docText(row['branch_name']);
  final date = docDate(row['count_date']);
  final lines = docNum(row['lines']);
  final counted = docNum(row['counted']);
  return [
    '${countStatusLabel(status)}${frozen ? ', stock frozen' : ''}',
    godown,
    if (lines != null && counted != null) '${counted.toInt()} of ${lines.toInt()} counted',
    if (date != null) ddMMMyyyy(date),
  ].where((p) => p.isNotEmpty).join(' · ');
}

/// `POST /api/stock-counts` body. One godown: a warehouse when the business has them, else a branch (the server picks
/// its default branch when neither is sent). The session names the business and the user.
Map<String, dynamic> openCountBody({
  required DateTime date,
  String warehouseId = '',
  String branchId = '',
  required bool blind,
  required bool freeze,
}) {
  return {
    'count_date': ymd(date),
    'blind': blind,
    'freeze_stock': freeze,
    if (warehouseId.isNotEmpty) 'warehouse_id': warehouseId else if (branchId.isNotEmpty) 'branch_id': branchId,
  };
}

/// `{ action: 'count' }`: counted quantities (and other people's goods found) per item, optionally in an alternate unit.
Map<String, dynamic> countEntriesBody(List<({String itemId, num physical, num others, String? unit})> entries) {
  return {
    'action': 'count',
    'entries': [
      for (final e in entries) {'item_id': e.itemId, 'physical_qty': e.physical, 'third_party_qty': e.others, 'unit': e.unit},
    ],
  };
}

/// `{ action: 'submit' }`. [fillFromBooks] takes uncounted items as matching the books.
Map<String, dynamic> submitCountBody({bool fillFromBooks = false}) => {'action': 'submit', if (fillFromBooks) 'fill_uncounted': 'book'};

Map<String, dynamic> postCountBody() => {'action': 'post'};

Map<String, dynamic> cancelCountBody() => {'action': 'cancel'};

Map<String, dynamic> reasonsBody(List<({String itemId, String code, String notes})> reasons) {
  return {
    'action': 'reasons',
    'reasons': [
      for (final r in reasons) {'item_id': r.itemId, 'reason_code': r.code, 'reason_notes': r.notes.trim().isEmpty ? null : r.notes.trim()},
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------

typedef CountBarcode = ({String itemId, num qty, String label});

/// `barcodes` from `GET /api/stock-counts/[id]/barcodes`; entries without an item are dropped.
Map<String, CountBarcode> parseCountBarcodes(dynamic body) {
  final raw = body is Map ? body['barcodes'] : null;
  if (raw is! Map) return const {};
  final out = <String, CountBarcode>{};
  raw.forEach((code, v) {
    if (v is! Map) return;
    final item = docText(v['item_id']);
    final qty = docNum(v['qty']);
    if (item.isEmpty || qty == null) return;
    out[code.toString()] = (itemId: item, qty: qty, label: docText(v['label']));
  });
  return out;
}

num _r3(num n) => (n * 1000).round() / 1000;

/// What the tally on the item reads after a scan adds [add] (one unit, or a whole box) to [start].
num tallyAfterScan(num start, num add) => _r3(start + add);

// ---------------------------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------------------------

bool countLineNeedsRecount(Map<String, dynamic> l) => l['recount_required'] == true && l['recounted'] != true;

String countLineState(Map<String, dynamic> l) {
  if (countLineNeedsRecount(l)) return 'Count again';
  if (docNum(l['physical_qty']) == null) return 'Not counted';
  return l['recounted'] == true ? 'Recounted' : 'Counted';
}

/// Where a scan starts adding from: what the server holds for the item, or nothing while it waits for a recount.
num countLineStartQty(Map<String, dynamic> l) => countLineNeedsRecount(l) ? 0 : (docNum(l['physical_qty']) ?? 0);

int countUncounted(List<Map<String, dynamic>> lines) => lines.where((l) => docNum(l['physical_qty']) == null).length;

List<Map<String, dynamic>> countDifferences(List<Map<String, dynamic>> lines) => [
      for (final l in lines)
        if ((docNum(l['difference']) ?? 0) != 0) l,
    ];

// ---------------------------------------------------------------------------------------------
// Questions and refusals
// ---------------------------------------------------------------------------------------------

String finishCountText(int uncounted) {
  const base = 'Counting closes and the count goes to review. The godown stays frozen until it is posted or cancelled.';
  if (uncounted <= 0) return base;
  final who = uncounted == 1 ? '1 item has not been counted' : '$uncounted items have not been counted';
  return '$base $who; ${uncounted == 1 ? 'it is' : 'they are'} taken as matching the books.';
}

String postCountText(int differences) {
  final n = differences == 1 ? '1 difference' : '$differences differences';
  return 'Post $n as stock adjustments and lock this count? Stock quantities change to the counted figures.';
}

String cancelCountText() => 'Cancel this count? Nothing is posted and the godown is unfrozen.';

String recountText(int n) => n == 1 ? '1 item is well off the book figure. Count it again.' : '$n items are well off the book figure. Count them again.';

/// "This count is already closed", a repeat tap or a second device: reload and say so quietly. The refusals with a
/// code of their own (`COUNT_OPEN`, `RECOUNT_PENDING`, `UNCOUNTED`, `REASON_REQUIRED`) are real refusals.
bool countAlreadyChanged(ApiException e) => e.status == 409 && (e.code == null || e.code!.isEmpty);

const kCountChangedText = 'This count has already changed. Showing the latest.';

// ---------------------------------------------------------------------------------------------
// Reasons and figures (shown as the server sent them)
// ---------------------------------------------------------------------------------------------

const _shortageReasons = <(String, String)>[
  ('STOCK_TAKE', 'Unexplained'),
  ('DAMAGE', 'Damaged'),
  ('THEFT', 'Theft'),
  ('EXPIRED', 'Expired'),
  ('PROCESS_LOSS', 'Normal process loss'),
  ('TRANSIT_LOSS', 'Lost in transit'),
  ('OWN_CONSUMPTION', 'Own use'),
  ('FREE_SAMPLE', 'Given as sample'),
  ('CUSTODY_LOSS', 'Lost while with a party'),
];

List<(String, String)> countReasonOptions({required bool shortage}) => shortage ? _shortageReasons : const [('STOCK_TAKE', 'Excess found')];

String countReasonLabel(String? code) {
  for (final (c, label) in _shortageReasons) {
    if (c == code) return label;
  }
  return 'Unexplained';
}

String _qty(dynamic v) => enIn(docNum(v) ?? 0);

String _less(dynamic v) {
  final n = docNum(v) ?? 0;
  return n > 0 ? '−${enIn(n)}' : '0';
}

List<(String, String)> countSummaryRows(Map<String, dynamic> s) {
  final un = docNum(s['unexplained_qty']) ?? 0;
  return [
    ('Book stock', _qty(s['book_qty'])),
    ('With third parties', _less(s['with_third_party_qty'])),
    ('In transit', _less(s['in_transit_qty'])),
    ('Expected in godown', _qty(s['expected_qty'])),
    ('Counted', _qty(s['physical_qty'])),
    ('Unexplained', '${un > 0 ? '+' : ''}${enIn(un)}'),
  ];
}

String countDiffText(Map<String, dynamic> l) {
  final d = docNum(l['difference']) ?? 0;
  return '${d > 0 ? '+' : ''}${enIn(d)}';
}

/// "Book 10 · Expected 8 · Counted 5 · ₹-300.00" (the value at cost, as the server worked it out).
String countDiffSubtitle(Map<String, dynamic> l) {
  final unit = docText(l['unit']);
  String q(dynamic v) => '${_qty(v)}${unit.isEmpty ? '' : ' $unit'}';
  final value = docNum(l['difference_value']);
  return [
    'Book ${q(l['book_qty'])}',
    'Expected ${q(l['expected_qty'])}',
    'Counted ${q(l['physical_qty'])}',
    if (value != null) inr(value, maxFraction: 2),
  ].join(' · ');
}

/// The website's line under the summary: shortage and excess at cost, and the warnings, all from the server's figures.
String countSummaryNote(Map<String, dynamic> s) {
  final unproven = (docNum(s['unproven']) ?? 0).toInt();
  final overdue = (docNum(s['overdue_returns']) ?? 0).toInt();
  final held = docNum(s['held_qty']) ?? 0;
  return [
    'Shortage ${inr(docNum(s['shortage_value']) ?? 0, maxFraction: 2)}, excess ${inr(docNum(s['excess_value']) ?? 0, maxFraction: 2)} at cost.',
    if (unproven > 0) '$unproven ${unproven == 1 ? 'line' : 'lines'} out of the godown ${unproven == 1 ? 'rests' : 'rest'} on an expired e-way bill.',
    if (overdue > 0) '$overdue challan ${overdue == 1 ? 'line is' : 'lines are'} past ${overdue == 1 ? 'its' : 'their'} return date.',
    if (held > 0) 'Expected includes ${enIn(held)} held (quarantine, QC, damaged, returns).',
  ].join(' ');
}
