import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'expense_categories_screen.dart';
import 'expense_logic.dart';

/// The shape of what is being edited: a bill with one item line (the form), a bill saved as one
/// amount, or a bill of several lines (kept as it is; the website edits those).
enum _Shape { single, header, many }

/// New and edit expense form from `app/(app)/expenses/new/page.tsx`. The session user is the actor.
///
/// A bill is one line: an expense item, quantity 1, the typed amount, a GST rate, and whether the
/// amount already includes GST. The totals under the form come from `POST /api/expenses/preview`.
/// The website also takes TDS, supplier GSTIN, registration, RCM, ITC and several lines; the phone
/// leaves those to the website, and there is no bill photo because the website has none.
class ExpenseFormScreen extends StatefulWidget {
  const ExpenseFormScreen({super.key, required this.session, this.expense});

  final AppSession session;

  /// The expense to edit, as `GET /api/expenses/[id]` returns it (with `lines`). Null adds one.
  final Map<String, dynamic>? expense;

  bool get editing => expense != null;

  @override
  State<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends State<ExpenseFormScreen> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _description = TextEditingController();

  List<(String id, String name)> _categories = const [];
  List<Map<String, dynamic>> _items = const [];
  bool _loading = true;
  bool _notInPlan = false;
  String? _loadError;

  _Shape _shape = _Shape.single;
  int _lineCount = 0;
  String _categoryId = '';
  String _itemId = '';
  String _itemName = '';
  num _rate = 0;
  bool _includesGst = false;
  String _supplierId = '';
  String _supplierName = '';
  String _mode = 'cash';
  String _accountId = '';
  DateTime _date = DateTime.now();

  List<(String id, String label)> _accounts = const [];
  bool _accountRequired = false;
  bool _accountHidden = false;
  bool _accountsFailed = false;

  /// On edit the saved account and mode stay as saved until the user changes the mode or the account.
  bool _accountTouched = false;
  bool _modeTouched = false;
  bool _previewFailed = false;
  int _accountsSeq = 0;

  ExpenseBill? _bill;
  Timer? _previewTimer;
  int _previewSeq = 0;

  ExpenseErrors _errors = const ExpenseErrors();
  bool _dirty = false;
  final String _key = _newKey();

  Map<String, dynamic> get _existing => widget.expense ?? const {};

  static String _newKey() {
    final r = Random.secure();
    return 'exp-${List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join()}';
  }

  @override
  void initState() {
    super.initState();
    if (widget.editing) _prefill();
    _amount.addListener(_amountTyped);
    _reference.addListener(_touch);
    _description.addListener(_touch);
    _loadRefs();
    _loadAccounts();
    if (widget.editing) _schedulePreview();
  }

  @override
  void dispose() {
    _previewTimer?.cancel();
    _amount.dispose();
    _reference.dispose();
    _description.dispose();
    super.dispose();
  }

  void _prefill() {
    final e = _existing;
    _categoryId = docText(e['category_id']);
    final day = docText(e['expense_date']);
    _date = DateTime.tryParse(day.length >= 10 ? day.substring(0, 10) : day) ?? DateTime.now();
    _reference.text = docText(e['reference_number']);
    _description.text = docText(e['description']);
    _mode = docText(e['payment_mode']).isEmpty ? 'cash' : docText(e['payment_mode']);
    // Older rows can hold `bank`; show it as Bank transfer. Not a change unless the user picks a mode.
    if (!kExpenseModes.any((m) => m.$1 == _mode)) _mode = isOnAccountMode(_mode) ? 'on_account' : (_mode == 'bank' ? 'bank_transfer' : _mode);
    _accountId = docText(e['settlement_account_id']);
    _supplierId = docText(e['supplier_id']);
    _supplierName = _supplierId.isEmpty ? '' : (docText(e['supplier_name']).isEmpty ? 'Saved supplier' : docText(e['supplier_name']));
    _includesGst = e['prices_include_gst'] == true;
    final lines = e['lines'] is List ? (e['lines'] as List).whereType<Map>().toList() : const <Map>[];
    _lineCount = lines.length;
    if (lines.length == 1) {
      final l = lines.first;
      _shape = _Shape.single;
      _itemId = docText(l['expense_item_id']);
      _itemName = docText(l['item_name']);
      _rate = docNum(l['tax_rate']) ?? 0;
      _amount.text = jsNumberString(docNum(l['unit_price']) ?? 0);
    } else if (lines.isEmpty) {
      _shape = _Shape.header;
      _amount.text = jsNumberString(docNum(e['amount']) ?? 0);
    } else {
      _shape = _Shape.many;
    }
  }

  void _touch() {
    if (!_dirty && mounted) setState(() => _dirty = true);
  }

  void _amountTyped() {
    _touch();
    _schedulePreview();
  }

  Future<void> _loadRefs() async {
    setState(() {
      _loading = true;
      _loadError = null;
      _notInPlan = false;
    });
    try {
      final api = widget.session.api;
      final replies = await Future.wait([api.getData('/api/expense-categories'), api.getData('/api/expense-items')]);
      if (!mounted) return;
      setState(() {
        _categories = [
          for (final c in docRows(replies[0], 'categories'))
            if (docText(c['id']).isNotEmpty) (docText(c['id']), docText(c['name'])),
        ];
        _items = docRows(replies[1], 'items');
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _notInPlan = e.code == 'FEATURE_NOT_IN_PLAN';
        _loadError = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadError = 'Could not reach the server.';
        _loading = false;
      });
    }
  }

  /// The cash or bank ledgers this payment mode may post to (`GET /api/accounting/settlement-accounts`).
  Future<void> _loadAccounts() async {
    final seq = ++_accountsSeq;
    final mode = _mode;
    try {
      final reply = await widget.session.api.getJson(Uri(path: '/api/accounting/settlement-accounts', queryParameters: {'payment_mode': mode}).toString());
      if (!mounted || seq != _accountsSeq) return;
      final modeClass = docText(reply['mode_class']);
      final hidden = modeClass == 'on_account' || modeClass == 'transfer';
      final options = [
        for (final a in docRows(reply, 'accounts'))
          if (docText(a['id']).isNotEmpty) (docText(a['id']), '${docText(a['account_code'])} — ${docText(a['account_name'])}'),
      ];
      setState(() {
        _accountsFailed = false;
        _errors = ExpenseErrors(category: _errors.category, item: _errors.item, amount: _errors.amount);
        _accountHidden = hidden;
        _accounts = hidden ? const [] : options;
        _accountRequired = !hidden && reply['selection_required'] == true;
        if (hidden) {
          _accountId = '';
        } else if (widget.editing && !_accountTouched) {
          // Keep what was saved, even when it is empty or no longer in the list.
        } else if (!options.any((o) => o.$1 == _accountId)) {
          _accountId = docText(reply['default_account_id']);
        }
      });
      _schedulePreview();
    } catch (_) {
      if (!mounted || seq != _accountsSeq) return;
      setState(() {
        _accounts = const [];
        _accountRequired = false;
        _accountsFailed = true;
      });
    }
  }

  List<(String, String)> get _itemOptions {
    final rows = [
      for (final i in _items)
        if (docText(i['id']).isNotEmpty) (docText(i['id']), docText(i['name'])),
    ];
    if (_itemId.isNotEmpty && !rows.any((r) => r.$1 == _itemId)) rows.add((_itemId, _itemName.isEmpty ? 'Saved item' : _itemName));
    return rows;
  }

  List<(num, String)> get _rateOptions {
    final rates = [...kGstRates];
    if (!rates.any((r) => r == _rate)) rates.add(_rate);
    return [for (final r in rates) (r, rateLabel(r))];
  }

  String get _amountText => _shape == _Shape.many ? '1' : _amount.text;
  String? get _previewItem => _shape == _Shape.single ? _itemId : null;

  /// Asks the server for the totals, 400 ms after the last change.
  void _schedulePreview() {
    _previewTimer?.cancel();
    final body = _shape == _Shape.single
        ? expensePreviewBody(
            categoryId: _categoryId,
            itemId: _previewItem,
            amount: _amount.text,
            rate: _rate,
            includesGst: _includesGst,
            supplierId: _supplierId,
            mode: _mode,
            accountId: _accountId,
            date: _date,
            description: _description.text,
          )
        : null;
    final seq = ++_previewSeq;
    if (body == null) {
      if ((_bill != null || _previewFailed) && mounted) {
        setState(() {
          _bill = null;
          _previewFailed = false;
        });
      }
      return;
    }
    _previewTimer = Timer(const Duration(milliseconds: 400), () async {
      ExpenseBill? bill;
      try {
        bill = readExpenseBill(await widget.session.api.postJson('/api/expenses/preview', body));
      } catch (_) {
        bill = null;
      }
      if (!mounted || seq != _previewSeq) return;
      setState(() {
        _bill = bill;
        _previewFailed = bill == null;
      });
    });
  }

  void _changed(VoidCallback fn) {
    setState(() {
      fn();
      _dirty = true;
    });
    _schedulePreview();
  }

  Future<void> _addCategory() async {
    final saved = await showExpenseCategorySheet(context, widget.session);
    if (saved == null || !mounted) return;
    final id = docText(saved['id']);
    if (id.isEmpty) return;
    _changed(() {
      _categories = [..._categories, (id, docText(saved['name']))]..sort((a, b) => a.$2.toLowerCase().compareTo(b.$2.toLowerCase()));
      _categoryId = id;
      _errors = const ExpenseErrors();
    });
  }

  Future<void> _addItem() async {
    final saved = await showKSheet<Map<String, dynamic>>(
      context,
      title: 'Add expense item',
      scrollable: true,
      builder: (ctx) => _NewItemSheet(api: widget.session.api, rate: _rate),
    );
    if (saved == null || !mounted) return;
    final id = docText(saved['id']);
    if (id.isEmpty) return;
    _changed(() {
      _items = [..._items, saved];
      _itemId = id;
      _itemName = docText(saved['name']);
      _rate = docNum(saved['tax_rate']) ?? _rate;
      _errors = const ExpenseErrors();
    });
  }

  void _pickItem(String id) {
    final item = _items.firstWhere((i) => docText(i['id']) == id, orElse: () => const {});
    _changed(() {
      _itemId = id;
      _itemName = docText(item['name']);
      final rate = docNum(item['tax_rate']);
      if (rate != null) _rate = rate;
      _errors = const ExpenseErrors();
    });
  }

  Future<void> _save() async {
    final errors = validateExpense(
      categoryId: _categoryId,
      itemId: _shape == _Shape.single ? _itemId : null,
      amount: _amountText,
      accountRequired: _accountRequired && !_accountHidden,
      accountId: _accountId,
    );
    // Without the account list a payment that needs an account cannot be saved.
    final blocked = _accountsFailed && !isOnAccountMode(_mode) && _accountId.isEmpty;
    setState(() => _errors = ExpenseErrors(
          category: errors.category,
          item: errors.item,
          amount: errors.amount,
          account: errors.account ?? (blocked ? 'Could not load accounts' : null),
        ));
    if (!errors.ok || blocked) return;
    final api = widget.session.api;
    if (widget.editing) {
      final body = expenseEditBody(
        existing: _existing,
        categoryId: _categoryId,
        itemId: _shape == _Shape.single ? _itemId : null,
        amount: _amountText,
        rate: _rate,
        includesGst: _includesGst,
        supplierId: _supplierId,
        mode: _modeTouched || docText(_existing['payment_mode']).isEmpty ? _mode : docText(_existing['payment_mode']),
        accountId: _accountId,
        date: _date,
        reference: _reference.text,
        description: _description.text,
      );
      if (body.isEmpty) {
        // Nothing changed: no request, nothing to reload.
        if (mounted) Navigator.of(context).pop(false);
        return;
      }
      await api.putJson('/api/expenses/${_existing['id']}', body);
    } else {
      await api.postJson(
        '/api/expenses',
        expenseBody(
          branchId: widget.session.defaultBranchId,
          categoryId: _categoryId,
          itemId: _itemId,
          amount: _amount.text,
          rate: _rate,
          includesGst: _includesGst,
          supplierId: _supplierId,
          mode: _mode,
          accountId: _accountId,
          date: _date,
          reference: _reference.text,
          description: _description.text,
          idempotencyKey: _key,
        ),
      );
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.editing ? 'Edit expense' : 'New expense';
    if (_loading || _loadError != null) {
      return Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(title),
              Expanded(
                child: _loading
                    ? const KSpinner(padding: EdgeInsets.symmetric(vertical: 64))
                    : ListView(children: [
                        if (_notInPlan)
                          const KEmptyState(icon: LucideIcons.lock, title: 'Not included in your current plan')
                        else
                          KEmptyState(
                            icon: LucideIcons.cloudOff,
                            title: 'Could not load the expense form',
                            body: _loadError,
                            action: KButton.secondary(label: 'Try again', expand: false, onPressed: _loadRefs),
                          ),
                      ]),
              ),
            ],
          ),
        ),
      );
    }

    final bill = _bill;
    return KFormScaffold(
      title: title,
      saveLabel: widget.editing ? 'Save changes' : 'Save expense',
      onSave: _save,
      dirty: _dirty,
      children: [
        KFormSection(title: 'Expense', children: [
          KPickField<String>(
            label: 'Category',
            value: _categoryId.isEmpty ? null : _categoryId,
            options: [for (final (id, name) in _categories) (id, name)],
            searchable: true,
            onChanged: (v) => _changed(() {
              _categoryId = v;
              _errors = const ExpenseErrors();
            }),
          ),
          if (_errors.category != null) _error(_errors.category!),
          Align(alignment: Alignment.centerLeft, child: KTextButton(label: 'Add category', onTap: _addCategory)),
          if (_shape == _Shape.single) ...[
            KPickField<String>(
              label: 'Expense item',
              value: _itemId.isEmpty ? null : _itemId,
              options: _itemOptions,
              searchable: true,
              onChanged: _pickItem,
            ),
            if (_errors.item != null) _error(_errors.item!),
            Align(alignment: Alignment.centerLeft, child: KTextButton(label: 'Add expense item', onTap: _addItem)),
          ],
          if (_shape == _Shape.many)
            KInfoCard(title: 'Items', rows: [('Lines', '$_lineCount items'), ('Change them', 'Edit the lines on the website')])
          else
            KAmountField(label: 'Amount', controller: _amount, error: _errors.amount),
          if (_shape == _Shape.single) ...[
            KPickField<num>(
              label: 'GST rate',
              value: _rate,
              options: _rateOptions,
              onChanged: (v) => _changed(() => _rate = v),
            ),
            KToggleField(
              label: 'Amount includes GST',
              help: 'Switch on if the amount you enter already has the GST in it.',
              value: _includesGst,
              onChanged: (v) => _changed(() => _includesGst = v),
            ),
          ],
          if (bill != null) _totals(bill),
          if (bill == null && _previewFailed) Text('Totals unavailable', style: AppText.caption),
        ]),
        KFormSection(title: 'Payment', children: [
          KPickField<String>(
            label: 'Payment',
            value: _mode,
            options: kExpenseModes,
            onChanged: (v) {
              _changed(() {
                _mode = v;
                _modeTouched = true;
                _accountTouched = true;
                _accountId = '';
                _accounts = const [];
                _accountsFailed = false;
              });
              _loadAccounts();
            },
          ),
          if (_accountsFailed && !isOnAccountMode(_mode)) ...[
            _error('Could not load accounts'),
            Align(alignment: Alignment.centerLeft, child: KTextButton(label: 'Try again', onTap: _loadAccounts)),
          ] else if (!_accountHidden && (_accounts.isNotEmpty || _accountId.isNotEmpty)) ...[
            KPickField<String>(
              label: _accountRequired ? 'Cash / bank account *' : 'Cash / bank account',
              value: _accountId.isEmpty ? null : _accountId,
              options: [
                ..._accounts,
                if (_accountId.isNotEmpty && !_accounts.any((a) => a.$1 == _accountId)) (_accountId, 'Saved account'),
              ],
              onChanged: (v) => _changed(() {
                _accountId = v;
                _accountTouched = true;
                _errors = const ExpenseErrors();
              }),
            ),
            if (_errors.account != null) _error(_errors.account!),
          ],
          KAsyncPickField(
            label: 'Supplier',
            valueLabel: _supplierId.isEmpty ? null : _supplierName,
            search: (q) => searchSuppliers(widget.session.api, q),
            onPicked: (id, name) => _changed(() {
              _supplierId = id;
              _supplierName = name;
            }),
          ),
          if (_supplierId.isNotEmpty)
            Align(
              alignment: Alignment.centerLeft,
              child: KTextButton(
                label: 'Remove supplier',
                color: AppColors.negative,
                onTap: () => _changed(() {
                  _supplierId = '';
                  _supplierName = '';
                }),
              ),
            ),
        ]),
        KFormSection(title: 'Details', children: [
          KDateField(label: 'Date', value: _date, onChanged: (d) => _changed(() => _date = d)),
          KTextField(label: 'Bill number', controller: _reference, hint: 'Optional'),
          KTextField(label: 'Description', controller: _description, hint: 'What was this expense for?', maxLines: 3),
        ]),
      ],
    );
  }

  Widget _error(String text) => Padding(
        padding: const EdgeInsets.only(left: 2),
        child: Text(text, style: AppText.caption.copyWith(color: AppColors.negative)),
      );

  /// The server's figures, as it sent them.
  Widget _totals(ExpenseBill b) {
    String money(num v) => inr(v, maxFraction: 2);
    final gst = b.cgst + b.sgst + b.igst;
    return KInfoCard(title: 'Totals', rows: [
      ('Bill total', money(b.amount)),
      if (gst > 0 && b.intraState) ...[('CGST', money(b.cgst)), ('SGST', money(b.sgst))],
      if (gst > 0 && !b.intraState) ('IGST', money(b.igst)),
    ]);
  }
}

/// `POST /api/expense-items` (name, goods or service, GST rate) from the "Add expense item" link.
class _NewItemSheet extends StatefulWidget {
  const _NewItemSheet({required this.api, required this.rate});

  final KhatarioApi api;
  final num rate;

  @override
  State<_NewItemSheet> createState() => _NewItemSheetState();
}

class _NewItemSheetState extends State<_NewItemSheet> {
  final _name = TextEditingController();
  String _type = 'service';
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter an item name');
      return;
    }
    setState(() {
      _error = null;
      _saving = true;
    });
    try {
      final reply = await widget.api.postJson('/api/expense-items', {'name': name, 'item_type': _type, 'tax_rate': _plain(widget.rate)});
      final item = reply['item'];
      if (mounted) Navigator.of(context).pop(item is Map ? Map<String, dynamic>.from(item) : null);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  static num _plain(num n) => n == n.truncate() ? n.truncate() : n;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KTextField(label: 'Item name', controller: _name, hint: 'e.g. Shop rent, Courier', error: _error),
          const SizedBox(height: AppSpace.md),
          KSegmented<String>(
            value: _type,
            options: const [('service', 'Service'), ('goods', 'Goods')],
            onChanged: (v) => setState(() => _type = v),
          ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Save item', loading: _saving, onPressed: _saving ? null : _save),
        ],
      ),
    );
  }
}
