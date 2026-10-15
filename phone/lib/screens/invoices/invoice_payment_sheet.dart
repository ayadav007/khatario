import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../../ui/web_ui.dart';
import 'invoice_form_logic.dart';

const _modes = [
  ('cash', 'Cash'),
  ('bank', 'Bank Transfer'),
  ('upi', 'UPI'),
  ('cheque', 'Cheque'),
  ('card', 'Card'),
  ('other', 'Other'),
];

/// Website `InvoicePaymentModal`: record one or more payments before the bill is saved.
///
/// Returns `null` when the sheet is dismissed, an empty list when [canLeaveUnpaid]
/// is used, and the entered rows otherwise.
Future<List<RecordedPayment>?> showInvoicePaymentSheet(
  BuildContext context, {
  required double grandTotal,
  required List<RecordedPayment> payments,
  bool canLeaveUnpaid = false,
  bool prefillFull = false,
  bool requireFull = false,
  String saveLabel = 'Save payments',
}) {
  return showModalBottomSheet<List<RecordedPayment>>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
    builder: (_) => _PaymentSheet(
      grandTotal: grandTotal,
      initial: payments,
      canLeaveUnpaid: canLeaveUnpaid,
      prefillFull: prefillFull,
      requireFull: requireFull,
      saveLabel: saveLabel,
    ),
  );
}

class _Row {
  _Row({required this.amount, required this.mode, required this.date, required this.reference});

  final TextEditingController amount;
  String mode;
  DateTime date;
  final TextEditingController reference;

  void dispose() {
    amount.dispose();
    reference.dispose();
  }
}

class _PaymentSheet extends StatefulWidget {
  const _PaymentSheet({
    required this.grandTotal,
    required this.initial,
    required this.canLeaveUnpaid,
    required this.prefillFull,
    required this.requireFull,
    required this.saveLabel,
  });

  final double grandTotal;
  final List<RecordedPayment> initial;
  final bool canLeaveUnpaid;
  final bool prefillFull;
  final bool requireFull;
  final String saveLabel;

  @override
  State<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends State<_PaymentSheet> {
  late final List<_Row> _rows;
  String? _error;

  @override
  void initState() {
    super.initState();
    final source = widget.initial.isEmpty
        ? [RecordedPayment(amount: widget.prefillFull ? widget.grandTotal : 0, mode: 'cash', date: ymd(DateTime.now()))]
        : widget.initial;
    _rows = [for (final p in source) _rowFrom(p)];
  }

  _Row _rowFrom(RecordedPayment p) {
    final row = _Row(
      amount: TextEditingController(text: p.amount == 0 ? '' : p.amount.toString()),
      mode: p.mode,
      date: DateTime.tryParse(p.date) ?? DateTime.now(),
      reference: TextEditingController(text: p.reference ?? ''),
    );
    row.amount.addListener(() {
      if (mounted) setState(() => _error = null);
    });
    return row;
  }

  @override
  void dispose() {
    for (final row in _rows) {
      row.dispose();
    }
    super.dispose();
  }

  double get _paid => _rows.fold(0.0, (sum, row) => sum + (double.tryParse(row.amount.text.trim()) ?? 0));

  void _quick(double fraction) {
    final amount = invoiceRound2(widget.grandTotal * fraction);
    setState(() => _rows.first.amount.text = amount.toString());
  }

  void _save() {
    final parsed = <RecordedPayment>[];
    for (final row in _rows) {
      final amount = double.tryParse(row.amount.text.trim()) ?? 0;
      if (amount <= 0) {
        setState(() => _error = 'All payment entries must have a valid amount greater than 0');
        return;
      }
      parsed.add(RecordedPayment(amount: amount, mode: row.mode, date: ymd(row.date), reference: row.reference.text));
    }
    final total = parsed.fold(0.0, (sum, p) => sum + p.amount);
    if (total > widget.grandTotal + 0.004) {
      setState(() => _error = 'Total payments (${inr(total, maxFraction: 2)}) cannot exceed the amount still to collect (${inr(widget.grandTotal, maxFraction: 2)})');
      return;
    }
    if (widget.requireFull && (total - widget.grandTotal).abs() > 0.02) {
      setState(() => _error = 'A cash sale has no customer, so the full amount has to be recorded now.');
      return;
    }
    Navigator.of(context).pop(parsed);
  }

  @override
  Widget build(BuildContext context) {
    final balance = invoiceRound2(widget.grandTotal - _paid);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Record payment', style: AppText.heading),
            if (widget.requireFull) ...[
              const SizedBox(height: 8),
              Text(
                'This cash sale has no customer, so record the amount now. A separate receipt cannot be added later.',
                style: AppText.caption.copyWith(color: AppColors.ink2),
              ),
            ],
            const SizedBox(height: 12),
            KCard(
              padding: const EdgeInsets.all(14),
              child: Column(
                children: [
                  _line('Grand total', inr(widget.grandTotal, maxFraction: 2), AppColors.ink),
                  _line('Total paid', inr(_paid, maxFraction: 2), AppColors.positive),
                  _line('Balance', inr(balance, maxFraction: 2), balance > 0.004 ? AppColors.negative : AppColors.positive),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: KButton.secondary(label: 'Full ${inr(widget.grandTotal, maxFraction: 2)}', height: 44, onPressed: () => _quick(1))),
                const SizedBox(width: 8),
                Expanded(child: KButton.secondary(label: '50% ${inr(widget.grandTotal / 2, maxFraction: 2)}', height: 44, onPressed: () => _quick(0.5))),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
            ],
            for (final (i, row) in _rows.indexed) ...[
              const SizedBox(height: 12),
              KCard(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text('Payment ${i + 1}', style: AppText.bodyStrong)),
                        if (_rows.length > 1)
                          KTextButton(label: 'Remove', color: AppColors.negative, onTap: () => setState(() => _rows.removeAt(i).dispose())),
                      ],
                    ),
                    WebInput(
                      label: 'Amount',
                      controller: row.amount,
                      placeholder: '0.00',
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    ),
                    if ((double.tryParse(row.amount.text) ?? 0) > 200000 && row.mode == 'cash')
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'Cash above ₹2,00,000 is against government rules. Use bank transfer, UPI, or cheque.',
                          style: AppText.caption.copyWith(color: AppColors.due),
                        ),
                      ),
                    const SizedBox(height: 8),
                    Text('Mode', style: AppText.label),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final mode in _modes)
                          KChip(label: mode.$2, selected: row.mode == mode.$1, onTap: () => setState(() => row.mode = mode.$1)),
                      ],
                    ),
                    const SizedBox(height: 8),
                    WebInput(label: 'Reference', controller: row.reference, placeholder: 'Txn ID / cheque no.'),
                    const SizedBox(height: 8),
                    KListRow(
                      title: 'Date',
                      subtitle: ddMMMyyyy(row.date),
                      trailing: const Icon(LucideIcons.calendar, size: 18, color: AppColors.ink3),
                      onTap: () async {
                        final picked = await showDatePicker(context: context, initialDate: row.date, firstDate: DateTime(2020), lastDate: DateTime(2100));
                        if (picked != null) setState(() => row.date = picked);
                      },
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            KButton.secondary(
              label: 'Add another payment',
              icon: LucideIcons.plus,
              onPressed: () => setState(() {
                _rows.add(_rowFrom(RecordedPayment(amount: 0, mode: 'cash', date: ymd(DateTime.now()))));
              }),
            ),
            const SizedBox(height: 12),
            if (widget.canLeaveUnpaid) ...[
              KButton.secondary(label: 'No payment now', onPressed: () => Navigator.of(context).pop(<RecordedPayment>[])),
              const SizedBox(height: 8),
            ],
            KButton(label: widget.saveLabel, onPressed: _save),
          ],
        ),
      ),
    );
  }

  Widget _line(String label, String value, Color color) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label, style: AppText.caption)),
          Text(value, style: AppText.bodyStrong.copyWith(color: color)),
        ],
      ),
    );
  }
}

/// Asks for the amount received, then posts the draft.
///
/// A cash sale must be paid in full here. A customer bill can be finalized with nothing received.
/// Returns true when the bill was posted.
Future<bool> finalizeDraftWithPayment(
  BuildContext context, {
  required KhatarioApi api,
  required String invoiceId,
  required String invoiceNumber,
  required double grandTotal,
  required bool hasCustomer,
}) async {
  final payments = await showInvoicePaymentSheet(
    context,
    grandTotal: grandTotal,
    payments: const [],
    canLeaveUnpaid: hasCustomer,
    prefillFull: true,
    requireFull: !hasCustomer,
    saveLabel: 'Finalize',
  );
  if (payments == null || !context.mounted) return false;
  try {
    if (payments.isEmpty) {
      await api.patchJson('/api/invoices/$invoiceId/finalize', const {});
    } else {
      final data = await api.getJson('/api/invoices/$invoiceId');
      final raw = data['invoice'];
      final invoice = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{'id': invoiceId};
      final draft = invoiceDraftFromRecord(invoice, status: 'final', payments: payments);
      await api.postJson('/api/invoices', invoiceCreateBody(draft));
    }
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$invoiceNumber finalized')));
    }
    return true;
  } on ApiException catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
    return false;
  }
}
