import '../../api.dart';
import '../../format.dart';
import '../docs/doc_logic.dart';

/// Held goods, manufacturing and insurance claims: request bodies, rows and questions.
///
/// Routes (`app/api/**`): `GET /api/stock-holds` `{ holds }`, `POST /api/stock-holds`, `POST /api/stock-holds/[id]`;
/// `GET /api/inward-custody` `{ goods }`, `POST /api/inward-custody`, `PATCH /api/inward-custody/[id]`;
/// `GET`/`POST /api/manufacturing/boms` `{ boms }`; `GET`/`POST /api/manufacturing/production` `{ entries }`;
/// `GET`/`POST /api/insurance-claims` `{ claims }`, `PATCH /api/insurance-claims/[id]`.
/// The phone never works out stock, cost or a claim figure: it shows what the server returns.

num _clean(num n) => n == n.truncateToDouble() ? n.toInt() : n;

num _r3(num n) => (n * 1000).round() / 1000;

String _q(dynamic v) => enIn(_r3(docNum(v) ?? 0));

String _unitQty(dynamic qty, String unit, String name) => '${_q(qty)}${unit.isEmpty ? '' : ' $unit'} $name';

String _words(String code) {
  final w = code.toLowerCase().replaceAll('_', ' ').trim();
  return w.isEmpty ? '' : w[0].toUpperCase() + w.substring(1);
}

/// A positive number from a text box, or null.
num? positiveQty(String text) {
  final n = num.tryParse(text.trim());
  return n != null && n.isFinite && n > 0 ? n : null;
}

/// Active godowns from `GET /api/warehouses` (`warehouses`), the table whose ids the stock service checks.
List<(String, String)> godownOptions(dynamic body) => [
      for (final w in docRows(body, 'warehouses'))
        if (docText(w['id']).isNotEmpty && w['is_active'] != false) (docText(w['id']), docText(w['name'])),
    ];

// ---------------------------------------------------------------------------------------------
// Held stock and others' goods
// ---------------------------------------------------------------------------------------------

const kHoldPurposes = <(String, String)>[
  ('quarantine', 'Quarantine'),
  ('qc_hold', 'QC hold'),
  ('damaged', 'Damaged, awaiting decision'),
  ('return_inspection', 'Return awaiting inspection'),
];

String holdPurposeLabel(String code) {
  for (final (c, label) in kHoldPurposes) {
    if (c == code) return label;
  }
  return _words(code);
}

const kOthersReasons = <(String, String)>[
  ('repair', 'In for repair'),
  ('job_work', 'Job work for them'),
  ('storage', 'Kept for them'),
  ('sold_not_collected', 'Sold, not collected'),
  ('other', 'Other'),
];

String othersReasonLabel(String code) {
  for (final (c, label) in kOthersReasons) {
    if (c == code) return label;
  }
  return _words(code);
}

/// What a write-off may be called (`WRITE_OFF` in `POST /api/stock-holds/[id]`).
const kWriteOffReasons = <(String, String)>[
  ('DAMAGE', 'Damaged'),
  ('EXPIRED', 'Expired'),
  ('WRITE_DOWN', 'Written down'),
  ('THEFT', 'Theft'),
];

String holdId(Map<String, dynamic> h) => docText(h['hold_id']);

String holdTitle(Map<String, dynamic> h) => docText(h['item_name']);

String holdSubtitle(Map<String, dynamic> h) {
  final since = docDate(h['hold_date']);
  return [
    '${_q(h['qty'])} held',
    holdPurposeLabel(docText(h['purpose'])),
    docText(h['hold_number']),
    if (since != null) 'since ${ddMMMyyyy(since)}',
    docText(h['warehouse_name']),
  ].where((p) => p.isNotEmpty).join(' · ');
}

String othersTitle(Map<String, dynamic> g) => docText(g['description']);

String othersSubtitle(Map<String, dynamic> g) {
  final unit = docText(g['unit']);
  final since = docDate(g['received_date']);
  final days = docNum(g['days_held']);
  return [
    '${_q(g['qty'])}${unit.isEmpty ? '' : ' $unit'}',
    docText(g['owner_name']),
    othersReasonLabel(docText(g['reason'])),
    if (since != null) 'received ${ddMMMyyyy(since)}',
    if (days != null) '${days.toInt()} ${days.toInt() == 1 ? 'day' : 'days'}',
    docText(g['warehouse_name']),
  ].where((p) => p.isNotEmpty).join(' · ');
}

Map<String, dynamic> _godown(String warehouseId, String branchId) =>
    {if (warehouseId.isNotEmpty) 'warehouse_id': warehouseId else if (branchId.isNotEmpty) 'branch_id': branchId};

/// `POST /api/stock-holds` body. One godown: a warehouse, else the branch. The session names the business and the user.
Map<String, dynamic> holdBody({
  required String itemId,
  required num qty,
  required String purpose,
  required DateTime date,
  String warehouseId = '',
  String branchId = '',
  String reference = '',
}) {
  return {
    'item_id': itemId,
    'qty': _clean(qty),
    'purpose': purpose,
    'date': ymd(date),
    ..._godown(warehouseId, branchId),
    if (reference.trim().isNotEmpty) 'reference': reference.trim(),
  };
}

/// `POST /api/stock-holds/[id]` body: release some back to saleable stock, or write some off (with its reason).
Map<String, dynamic> settleBody({required DateTime date, num? release, num? writeOff, String reason = 'DAMAGE'}) {
  return {
    'date': ymd(date),
    if (release != null) 'release': _clean(release),
    if (writeOff != null) ...{'write_off': _clean(writeOff), 'reason': reason},
  };
}

String releaseText(Map<String, dynamic> h, num qty) => 'Release ${_q(qty)} of ${holdTitle(h)} (${docText(h['hold_number'])}) back to saleable stock?';

String writeOffText(Map<String, dynamic> h, num qty, String reasonLabel) =>
    'Write off ${_q(qty)} of ${holdTitle(h)} (${docText(h['hold_number'])}) as $reasonLabel? It leaves stock for good.';

/// `POST /api/inward-custody` body (`owner_type` is always "other", as on the website).
Map<String, dynamic> othersBody({
  required String owner,
  required String description,
  required num qty,
  String unit = '',
  required String reason,
  required DateTime date,
  String warehouseId = '',
  String branchId = '',
  String reference = '',
}) {
  return {
    'owner_type': 'other',
    'owner_name': owner.trim(),
    'description': description.trim(),
    'qty': _clean(qty),
    'unit': unit.trim().isEmpty ? 'PCS' : unit.trim(),
    'reason': reason,
    'received_date': ymd(date),
    ..._godown(warehouseId, branchId),
    if (reference.trim().isNotEmpty) 'reference': reference.trim(),
  };
}

/// `PATCH /api/inward-custody/[id]` body: goods handed back to their owner.
Map<String, dynamic> returnBody(num qty, DateTime date) => {'qty': _clean(qty), 'date': ymd(date)};

String returnText(Map<String, dynamic> g, num qty) => 'Hand back ${_q(qty)} of ${othersTitle(g)} to ${docText(g['owner_name'])}?';

String? holdRefusal({required String itemId, required num qty, bool needsGodown = false, String godownId = ''}) {
  if (itemId.isEmpty || !(qty > 0)) return 'Choose the item and quantity';
  if (needsGodown && godownId.isEmpty) return 'Choose the godown';
  return null;
}

String? othersRefusal({required String owner, required String description, required num qty, bool needsGodown = false, String godownId = ''}) {
  if (owner.trim().isEmpty || description.trim().isEmpty || !(qty > 0)) return 'Enter the owner, the goods and the quantity';
  if (needsGodown && godownId.isEmpty) return 'Choose the godown';
  return null;
}

/// A hold already closed, or goods already handed back (a repeat tap, or another phone): reload and say so quietly.
/// "Only 2 is still held." is a real refusal and is shown as the server words it.
bool holdAlreadyChanged(ApiException e) =>
    e.status == 409 && (e.message.startsWith('This hold is already closed') || e.message.startsWith('These goods have already gone back'));

const kHoldChangedText = 'This has already changed. Showing the latest.';

// ---------------------------------------------------------------------------------------------
// Manufacturing
// ---------------------------------------------------------------------------------------------

const kBomRoles = <(String, String)>[
  ('input', 'Input'),
  ('byproduct', 'By-product'),
  ('scrap', 'Scrap'),
];

String bomRoleLabel(String role) {
  for (final (r, label) in kBomRoles) {
    if (r == role) return label;
  }
  return _words(role);
}

String bomTitle(Map<String, dynamic> b) => docText(b['name']);

bool bomIsActive(Map<String, dynamic> b) => b['is_active'] != false;

List<Map<String, dynamic>> _bomLines(Map<String, dynamic> b) => docRows(b, 'lines');

/// "Makes 10 Biscuits · 2 inputs, 1 scrap".
String bomSubtitle(Map<String, dynamic> b) {
  int n(String role) => _bomLines(b).where((l) => docText(l['role']) == role).length;
  final inputs = n('input');
  final by = n('byproduct');
  final scrap = n('scrap');
  final unit = docText(b['output_unit']);
  return [
    'Makes ${_unitQty(b['output_qty'], unit, docText(b['output_item_name']))}',
    [
      '$inputs ${inputs == 1 ? 'input' : 'inputs'}',
      if (by > 0) '$by ${by == 1 ? 'by-product' : 'by-products'}',
      if (scrap > 0) '$scrap scrap',
    ].join(', '),
  ].join(' · ');
}

/// One recipe line as (role, text): "Input", "20 KG Flour"; a by-product or scrap says what it fetches.
List<(String, String)> bomLineRows(Map<String, dynamic> b) {
  return [
    for (final l in _bomLines(b))
      (
        bomRoleLabel(docText(l['role'])),
        [
          _unitQty(l['qty'], docText(l['unit']), docText(l['item_name'])),
          if (docText(l['role']) != 'input' && (docNum(l['recovery_rate']) ?? 0) > 0) 'fetches ${inr(docNum(l['recovery_rate'])!, maxFraction: 2)} each',
        ].join(' · '),
      ),
  ];
}

/// "Each batch takes 20 KG Flour, 5 KG Sugar and makes 10 Biscuits." The recipe's own figures, not scaled.
String bomBatchText(Map<String, dynamic> b) {
  final inputs = [
    for (final l in _bomLines(b))
      if (docText(l['role']) == 'input') _unitQty(l['qty'], docText(l['unit']), docText(l['item_name'])),
  ];
  final makes = _unitQty(b['output_qty'], docText(b['output_unit']), docText(b['output_item_name']));
  return 'Each batch takes ${inputs.join(', ')} and makes $makes.';
}

typedef BomLine = ({String itemId, String role, num qty, num recovery});

/// `POST /api/manufacturing/boms` body. Lines with no item are dropped.
Map<String, dynamic> bomBody({required String name, required String outputItemId, required num outputQty, required List<BomLine> lines}) {
  return {
    'name': name.trim(),
    'output_item_id': outputItemId,
    'output_qty': _clean(outputQty),
    'lines': [
      for (final l in lines)
        if (l.itemId.isNotEmpty) {'item_id': l.itemId, 'role': l.role, 'qty': _clean(l.qty), 'recovery_rate': _clean(l.recovery)},
    ],
  };
}

/// The server's own refusals, said before sending.
String? bomRefusal({required String name, required String outputItemId, required num outputQty, required List<BomLine> lines}) {
  if (name.trim().isEmpty) return 'Name the bill of materials';
  if (outputItemId.isEmpty) return 'Choose what it makes';
  if (!(outputQty > 0)) return 'Output quantity must be more than zero';
  if (!lines.any((l) => l.role == 'input' && l.itemId.isNotEmpty && l.qty > 0)) return 'Add at least one input';
  return null;
}

String productionTitle(Map<String, dynamic> e) => docText(e['entry_number']);

/// "20 Biscuits · 06 Nov 2026 · used 40 Flour, 10 Sugar".
String productionSubtitle(Map<String, dynamic> e) {
  final date = docDate(e['entry_date']);
  final used = [
    for (final l in docRows(e, 'lines'))
      if (docText(l['role']) == 'input') '${_q(l['qty'])} ${docText(l['item_name'])}',
  ];
  return [
    '${_q(e['output_qty'])} ${docText(e['output_item_name'])}',
    if (date != null) ddMMMyyyy(date),
    if (used.isNotEmpty) 'used ${used.join(', ')}',
  ].where((p) => p.isNotEmpty).join(' · ');
}

/// What the entry cost to make, as the server worked it out.
num? productionCost(Map<String, dynamic> e) => docNum(e['output_cost']);

/// `POST /api/manufacturing/production` body.
Map<String, dynamic> productionBody({required String bomId, required num batches, required DateTime date, String warehouseId = '', String branchId = ''}) {
  return {'bom_id': bomId, 'batches': _clean(batches), 'date': ymd(date), ..._godown(warehouseId, branchId)};
}

String? productionRefusal({required String bomId, required num batches, bool needsGodown = false, String godownId = ''}) {
  if (bomId.isEmpty) return 'Choose a bill of materials';
  if (!(batches > 0)) return 'Enter how many batches';
  if (needsGodown && godownId.isEmpty) return 'Choose the godown';
  return null;
}

/// The question before production: names the recipe and the batches, and says stock moves.
String productionAskText(Map<String, dynamic> bom, num batches) {
  final n = jsNumberString(batches);
  return 'Post production of $n ${batches == 1 ? 'batch' : 'batches'} of ${bomTitle(bom)}? ${bomBatchText(bom)} '
      'Posting takes the inputs out of stock and adds the finished goods.';
}

String productionDoneText(Map<String, dynamic> reply) {
  final number = docText(reply['number']);
  final cost = docNum(reply['output_unit_cost']);
  if (number.isEmpty) return 'Production posted';
  return cost == null ? '$number posted' : '$number posted: output at ${inr(cost, maxFraction: 2)} each';
}

// ---------------------------------------------------------------------------------------------
// Insurance claims
// ---------------------------------------------------------------------------------------------

const kClaimCauses = <(String, String)>[
  ('theft', 'Theft'),
  ('fire', 'Fire'),
  ('flood', 'Flood'),
  ('transit', 'Transit'),
  ('damage', 'Damage'),
  ('other', 'Other'),
];

String claimCauseLabel(String code) {
  for (final (c, label) in kClaimCauses) {
    if (c == code) return label;
  }
  return _words(code);
}

String claimStatusLabel(String status) => _words(status);

/// The website's list has no filter; the phone adds status chips, applied on the phone.
const kClaimFilters = <(String, String)>[
  ('', 'All'),
  ('lodged', 'Lodged'),
  ('admitted', 'Admitted'),
  ('settled', 'Settled'),
  ('rejected', 'Rejected'),
];

bool claimMatchesFilter(Map<String, dynamic> c, String filter) => filter.isEmpty || docText(c['status']) == filter;

String claimTitle(Map<String, dynamic> c) => docText(c['claim_number']);

String claimSubtitle(Map<String, dynamic> c) {
  final date = docDate(c['loss_date']);
  final fir = docText(c['fir_number']);
  return [
    if (date != null) ddMMMyyyy(date),
    claimCauseLabel(docText(c['cause'])),
    docText(c['insurer']),
    if (fir.isNotEmpty) 'FIR $fir',
  ].where((p) => p.isNotEmpty).join(' · ');
}

num? claimClaimed(Map<String, dynamic> c) => docNum(c['claimed_amount']);

enum ClaimAction { admit, settle, reject }

List<ClaimAction> claimActions(String status) => switch (status) {
      'lodged' => const [ClaimAction.admit, ClaimAction.reject],
      'admitted' => const [ClaimAction.settle, ClaimAction.reject],
      _ => const [],
    };

/// `POST /api/insurance-claims` body. Optional fields that were left empty are not sent.
Map<String, dynamic> claimBody({
  required DateTime lossDate,
  required String cause,
  required String insurer,
  String policy = '',
  String firNumber = '',
  DateTime? firDate,
  String surveyor = '',
  required num claimed,
  List<String> adjustmentIds = const [],
}) {
  return {
    'loss_date': ymd(lossDate),
    'cause': cause,
    'insurer': insurer.trim(),
    if (policy.trim().isNotEmpty) 'policy_number': policy.trim(),
    if (firNumber.trim().isNotEmpty) 'fir_number': firNumber.trim(),
    if (firDate != null) 'fir_date': ymd(firDate),
    if (surveyor.trim().isNotEmpty) 'surveyor': surveyor.trim(),
    'claimed_amount': _clean(claimed),
    if (adjustmentIds.isNotEmpty) 'adjustment_ids': adjustmentIds,
  };
}

String? claimRefusal({required String cause, required String insurer, required num claimed, required String firNumber}) {
  if (insurer.trim().isEmpty) return 'Name the insurer';
  if (!(claimed > 0)) return 'Enter the amount claimed';
  if (cause == 'theft' && firNumber.trim().isEmpty) return 'A theft claim needs the FIR number';
  return null;
}

Map<String, dynamic> admitBody(num amount, DateTime date) => {'action': 'admit', 'amount': _clean(amount), 'date': ymd(date)};

Map<String, dynamic> settleClaimBody(num amount, DateTime date, String accountId) =>
    {'action': 'settle', 'amount': _clean(amount), 'date': ymd(date), 'account_id': accountId};

Map<String, dynamic> rejectBody(DateTime date) => {'action': 'reject', 'date': ymd(date)};

String admitText(Map<String, dynamic> c, num amount) =>
    'Admit ${inr(amount, maxFraction: 2)} on ${claimTitle(c)}? That amount moves from Stock Loss to Insurance Claims Receivable.';

String settleText(Map<String, dynamic> c, num amount, String account) =>
    'Record ${inr(amount, maxFraction: 2)} received into $account for ${claimTitle(c)}? Any shortfall against the admitted amount goes back to the loss.';

String rejectText(Map<String, dynamic> c) =>
    'Mark ${claimTitle(c)} as rejected?${docText(c['status']) == 'admitted' ? ' The admitted amount goes back to the loss.' : ''}';

const _lossReasons = ['DAMAGE', 'THEFT', 'TRANSIT_LOSS', 'CUSTODY_LOSS', 'EXPIRED'];

/// Write-offs a claim may cover: quantity decreases for a loss reason (the website's own filter).
List<Map<String, dynamic>> claimWriteOffs(List<Map<String, dynamic>> adjustments) => [
      for (final a in adjustments)
        if (docText(a['direction']) == 'DECREASE' && _lossReasons.contains(docText(a['reason_code'])) && docText(a['id']).isNotEmpty) a,
    ];

String claimWriteOffLabel(Map<String, dynamic> a) {
  final qty = (docNum(a['quantity_change']) ?? 0).abs();
  final value = (docNum(a['value_change']) ?? 0).abs();
  return [docText(a['adjustment_number']), docText(a['item_name']), _q(qty), inr(value, maxFraction: 2)].where((p) => p.isNotEmpty).join(' · ');
}

/// The accounts the money can come into: 1101, 1102, or a name with "bank" or "cash" (the website's filter).
List<(String, String)> bankAccountOptions(List<Map<String, dynamic>> accounts) {
  final named = RegExp('bank|cash', caseSensitive: false);
  return [
    for (final a in accounts)
      if (docText(a['id']).isNotEmpty && (const ['1101', '1102'].contains(docText(a['account_code'])) || named.hasMatch(docText(a['account_name']))))
        (docText(a['id']), '${docText(a['account_code'])} ${docText(a['account_name'])}'.trim()),
  ];
}

/// One account is the answer; of several, the 1102 bank account, else the first.
String defaultBankAccount(List<(String, String)> options) {
  if (options.isEmpty) return '';
  if (options.length == 1) return options.first.$1;
  for (final (id, label) in options) {
    if (label.startsWith('1102')) return id;
  }
  return options.first.$1;
}

/// The claim has moved on since the phone last looked (a repeat tap, or another device): reload and say so quietly.
bool claimAlreadyChanged(ApiException e) =>
    e.status == 409 && RegExp(r'cannot be (admitted|rejected)|Admit the claim before').hasMatch(e.message);

const kClaimChangedText = 'This claim has already changed. Showing the latest.';
