import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import 'expense_form_screen.dart';
import 'expense_logic.dart';

/// `app/(app)/expenses/page.tsx`: the expenses, newest first, grouped by day, with a chip per
/// category (`GET /api/expenses?category_id=`). The route does not page, and it sends no total, so
/// there is no month-total tile: the phone does not add up ledger figures.
class ExpensesScreen extends StatefulWidget {
  const ExpensesScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ExpensesScreen> createState() => _ExpensesScreenState();
}

class _ExpensesScreenState extends State<ExpensesScreen> {
  List<(String, String)> _categories = const [];

  @override
  void initState() {
    super.initState();
    _loadCategories();
  }

  /// The chips. If this fails the list still works with "All" only.
  Future<void> _loadCategories() async {
    try {
      final body = await widget.session.api.getData('/api/expense-categories');
      if (!mounted) return;
      setState(() {
        _categories = [
          for (final c in docRows(body, 'categories'))
            if (docText(c['id']).isNotEmpty && docText(c['name']).isNotEmpty) (docText(c['id']), docText(c['name'])),
        ];
      });
    } catch (_) {
      // "All" only.
    }
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: 'Expenses',
        href: '/expenses',
        path: '/api/expenses',
        listKey: 'expenses',
        titleOf: expenseTitle,
        subtitleOf: expenseSubtitle,
        amountOf: (r) => docNum(r['amount']),
        statusOf: (r) => isOnAccountMode(docText(r['payment_mode'])) ? 'unpaid' : null,
        searchKeys: const ['description', 'category_name', 'reference_number'],
        filters: [('', 'All'), ..._categories],
        filterParam: 'category_id',
        icon: LucideIcons.receipt,
        emptyTitle: 'No expenses recorded yet',
        emptyBody: 'Add your first expense.',
        createLabel: 'Add expense',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => ExpenseFormScreen(session: session))),
        onOpen: (ctx, row) => Navigator.of(ctx).push<bool>(MaterialPageRoute(builder: (_) => ExpenseDetailScreen(session: session, row: row))),
      ),
    );
  }
}

/// One expense: `GET /api/expenses/[id]` (`expense`, with `lines`), Edit (`PUT`) and Delete
/// (`DELETE`, after a confirm sheet). [row] is the list row; it draws at once and supplies the
/// category name, which the single-expense route does not return.
class ExpenseDetailScreen extends StatelessWidget {
  const ExpenseDetailScreen({super.key, required this.session, required this.row});

  final AppSession session;
  final Map<String, dynamic> row;

  static Future<Map<String, dynamic>> _load(KhatarioApi api, Map<String, dynamic> row) async {
    final body = await api.getJson('/api/expenses/${row['id']}');
    final expense = body['expense'];
    if (expense is! Map) throw ApiException('Expense not found');
    return {...row, ...Map<String, dynamic>.from(expense)};
  }

  static String _money(num v) => inr(v, maxFraction: 2);

  Future<bool?> _edit(BuildContext context, Map<String, dynamic> doc) {
    return Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ExpenseFormScreen(session: session, expense: doc)));
  }

  /// Asks first, then reverses. Leaves the page when it is gone so the list reloads.
  Future<bool?> _delete(BuildContext context, Map<String, dynamic> doc) async {
    final amount = docNum(doc['amount']);
    final day = docDate(doc['expense_date']);
    final reason = await showKSheet<String>(
      context,
      title: 'Delete this expense?',
      scrollable: true,
      builder: (ctx) => _DeleteSheet(amount: amount == null ? '' : _money(amount), date: day == null ? '' : ddMMMyyyy(day)),
    );
    if (reason == null || !context.mounted) return null;
    await session.api.deleteJson(Uri(path: '/api/expenses/${doc['id']}', queryParameters: {'reason': reason}).toString());
    if (!context.mounted) return null;
    showKToast(context, 'Expense deleted', tone: KTone.positive);
    Navigator.of(context).pop(true);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: row,
      spec: DocDetailSpec(
        title: 'Expense',
        load: (api) => _load(api, row),
        numberOf: expenseTitle,
        statusOf: (d) => isOnAccountMode(docText(d['payment_mode'])) ? 'unpaid' : null,
        partyOf: (d) => docText(d['category_name']),
        amountOf: (d) => docNum(d['amount']),
        facts: (d) {
          final day = docDate(d['expense_date']);
          final gst = (docNum(d['cgst_amount']) ?? 0) + (docNum(d['sgst_amount']) ?? 0) + (docNum(d['igst_amount']) ?? 0);
          final tds = docNum(d['tds_amount']) ?? 0;
          return [
            ('Date', day == null ? '' : ddMMMyyyy(day)),
            ('Payment', expenseModeLabel(docText(d['payment_mode']))),
            ('Bill number', docText(d['reference_number'])),
            ('Description', docText(d['description'])),
            if (gst > 0) ('GST credit', d['is_reverse_charge'] == true ? 'Reverse charge' : (d['itc_eligible'] == false ? 'Not claimed' : 'Claimed')),
            if (tds > 0) ('TDS', '${docText(d['tds_section'])} ${_money(tds)}'.trim()),
          ];
        },
        lines: (d) {
          final raw = d['lines'];
          if (raw is! List) return const [];
          return [
            for (final l in raw.whereType<Map>())
              DocLine(
                docText(l['item_name']).isEmpty ? 'Item' : docText(l['item_name']),
                subtitle: '${jsNumberString(docNum(l['quantity']) ?? 1)} × ${_money(docNum(l['unit_price']) ?? 0)} · GST ${rateLabel(docNum(l['tax_rate']) ?? 0)}',
                amount: docNum(l['line_total']),
              ),
          ];
        },
        totals: (d) {
          final cgst = docNum(d['cgst_amount']) ?? 0;
          final sgst = docNum(d['sgst_amount']) ?? 0;
          final igst = docNum(d['igst_amount']) ?? 0;
          return [
            if (cgst > 0) ('CGST', cgst),
            if (sgst > 0) ('SGST', sgst),
            if (igst > 0) ('IGST', igst),
            if (cgst + sgst + igst > 0) ('Total', docNum(d['amount'])),
          ];
        },
        primary: (d) => DocAction('Edit', LucideIcons.pencil, (ctx) => _edit(ctx, d)),
        actions: (d) => [DocAction('Delete expense', LucideIcons.trash2, (ctx) => _delete(ctx, d), danger: true)],
      ),
    );
  }
}

/// "Delete this expense?" with the amount and date, and the reason the website asks for.
class _DeleteSheet extends StatefulWidget {
  const _DeleteSheet({required this.amount, required this.date});

  final String amount, date;

  @override
  State<_DeleteSheet> createState() => _DeleteSheetState();
}

class _DeleteSheetState extends State<_DeleteSheet> {
  final _reason = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final what = [widget.amount, if (widget.date.isNotEmpty) 'on ${widget.date}'].where((p) => p.isNotEmpty).join(' ');
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '${what.isEmpty ? 'This expense' : what} will be reversed in your books. The original entry stays in the audit history.',
            style: AppText.body.copyWith(color: AppColors.ink2),
          ),
          const SizedBox(height: AppSpace.md),
          KTextField(label: 'Reason for deleting', controller: _reason, hint: 'e.g. Entered twice, wrong amount', error: _error),
          const SizedBox(height: AppSpace.lg),
          KButton(
            label: 'Delete expense',
            kind: KButtonKind.danger,
            onPressed: () {
              final reason = _reason.text.trim();
              if (reason.isEmpty) {
                setState(() => _error = 'Add a reason');
                return;
              }
              Navigator.of(context).pop(reason);
            },
          ),
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(label: 'Keep it', onPressed: () => Navigator.of(context).pop()),
        ],
      ),
    );
  }
}
