import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/web_ui.dart';

/// `components/modals/RecordPaymentModal.tsx`. Returns true when the server recorded the payment.
Future<bool> showRecordPaymentDialog(
  BuildContext context, {
  required KhatarioApi api,
  required String invoiceId,
  required String invoiceNumber,
  required num grandTotal,
  required num paidAmount,
  required num balanceAmount,
  DateTime? today,
}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    useSafeArea: true,
    backgroundColor: AppColors.surface,
    barrierColor: AppColors.scrim,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
    builder: (_) => _RecordPaymentDialog(
      api: api,
      invoiceId: invoiceId,
      invoiceNumber: invoiceNumber,
      grandTotal: grandTotal,
      paidAmount: paidAmount,
      balanceAmount: balanceAmount,
      today: today ?? DateTime.now(),
    ),
  );
  return ok == true;
}

class _RecordPaymentDialog extends StatefulWidget {
  const _RecordPaymentDialog({
    required this.api,
    required this.invoiceId,
    required this.invoiceNumber,
    required this.grandTotal,
    required this.paidAmount,
    required this.balanceAmount,
    required this.today,
  });

  final KhatarioApi api;
  final String invoiceId;
  final String invoiceNumber;
  final num grandTotal;
  final num paidAmount;
  final num balanceAmount;
  final DateTime today;

  @override
  State<_RecordPaymentDialog> createState() => _RecordPaymentDialogState();
}

class _RecordPaymentDialogState extends State<_RecordPaymentDialog> {
  static const _modes = [
    ('cash', 'Cash'),
    ('bank_transfer', 'Bank Transfer'),
    ('upi', 'UPI'),
    ('card', 'Card'),
    ('cheque', 'Cheque'),
    ('other', 'Other'),
  ];
  static const _tdsSections = [
    ('194C', '194C'),
    ('194J', '194J'),
    ('194H', '194H'),
    ('194I', '194I'),
    ('194Q', '194Q'),
    ('194O', '194O'),
    ('other', 'Other'),
  ];

  late final _amount = TextEditingController(text: jsNumberString(widget.balanceAmount));
  final _tds = TextEditingController();
  final _reference = TextEditingController();
  late DateTime _paymentDate = dateOnly(widget.today);
  String _mode = 'cash';
  String _tdsSection = '194C';
  bool _loading = false;
  String _error = '';

  @override
  void dispose() {
    _amount.dispose();
    _tds.dispose();
    _reference.dispose();
    super.dispose();
  }

  static double? _parse(String s) => s.trim().isEmpty ? 0 : double.tryParse(s.trim());

  /// Received amount follows TDS while it still equals the full balance.
  void _onTdsChanged(String next) {
    final prevTds = double.tryParse(_tdsPrev) ?? 0;
    final nextTds = double.tryParse(next) ?? 0;
    final received = double.tryParse(_amount.text) ?? 0;
    if ((received + prevTds - widget.balanceAmount).abs() < 0.01) {
      final v = ((widget.balanceAmount - nextTds) * 100).round() / 100;
      _amount.text = jsNumberString(v < 0 ? 0 : v);
    }
    _tdsPrev = next;
    setState(() {});
  }

  String _tdsPrev = '';

  Future<void> _submit() async {
    setState(() => _error = '');
    final paymentAmount = _parse(_amount.text);
    final tds = _parse(_tds.text);
    if (paymentAmount == null || tds == null || paymentAmount < 0 || tds < 0 || paymentAmount + tds <= 0) {
      setState(() => _error = 'Please enter a valid amount');
      return;
    }
    if (paymentAmount + tds > widget.balanceAmount + 0.01) {
      setState(() => _error = 'Amount received plus TDS cannot exceed balance of $rupeeSign${enIn(widget.balanceAmount)}');
      return;
    }
    setState(() => _loading = true);
    try {
      await widget.api.patchJson('/api/invoices/${widget.invoiceId}/payments', {
        'amount': paymentAmount,
        'payment_mode': _mode,
        'reference': _reference.text.isEmpty ? null : _reference.text,
        'payment_date': ymd(_paymentDate),
        'tds_amount': tds,
        'tds_section': tds > 0 ? _tdsSection : null,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message.isEmpty ? 'Failed to record payment' : e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Failed to record payment');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _paymentDate,
      firstDate: DateTime(2000),
      lastDate: DateTime(2100),
    );
    if (picked != null) setState(() => _paymentDate = picked);
  }

  @override
  Widget build(BuildContext context) {
    final tdsEntered = (double.tryParse(_tds.text) ?? 0) > 0;
    final half = ((widget.balanceAmount / 2) * 100).round() / 100;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        top: false,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.92),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 8),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(color: AppColors.hairline, borderRadius: BorderRadius.circular(4)),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 10, 8, 0),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(color: AppTints.green.$1, borderRadius: BorderRadius.circular(12)),
                      child: Icon(LucideIcons.handCoins, size: 20, color: AppTints.green.$2),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Record Payment', style: AppText.heading),
                          Text.rich(
                            TextSpan(
                              text: 'Invoice: ',
                              children: [TextSpan(text: widget.invoiceNumber, style: const TextStyle(fontWeight: FontWeight.w600))],
                            ),
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                    KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: _loading ? () {} : () => Navigator.of(context).pop(false)),
                  ],
                ),
              ),
              Flexible(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: AppColors.dueSoft, borderRadius: BorderRadius.circular(AppRadius.lg)),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Balance due', style: AppText.label.copyWith(color: AppColors.due)),
                                  KAmount(widget.balanceAmount, style: AppText.amount, maxFraction: 2, color: AppColors.due),
                                ],
                              ),
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text('Total $rupeeSign${enIn(widget.grandTotal)}', style: AppText.caption.copyWith(fontSize: 12, color: AppColors.ink2)),
                                Text('Paid $rupeeSign${enIn(widget.paidAmount)}', style: AppText.caption.copyWith(fontSize: 12, color: AppColors.positive)),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                      if (_error.isNotEmpty) ...[
                        Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(color: AppColors.negativeSoft, borderRadius: BorderRadius.circular(AppRadius.md)),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(LucideIcons.circleAlert, size: 18, color: AppColors.negative),
                              const SizedBox(width: 8),
                              Expanded(child: Text(_error, style: AppText.label.copyWith(color: AppColors.negative))),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),
                      ],
                      _label('Amount received'),
                      _input(_amount, placeholder: 'Enter amount', number: true, big: true),
                      const SizedBox(height: 8),
                      Wrap(
                        spacing: 8,
                        children: [
                          KChip(
                            label: 'Full $rupeeSign${enIn(widget.balanceAmount)}',
                            selected: _amount.text == jsNumberString(widget.balanceAmount),
                            onTap: () => setState(() => _amount.text = jsNumberString(widget.balanceAmount)),
                          ),
                          if (widget.balanceAmount > 1)
                            KChip(
                              label: 'Half $rupeeSign${enIn(half)}',
                              selected: _amount.text == jsNumberString(half),
                              onTap: () => setState(() => _amount.text = jsNumberString(half)),
                            ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      _label('Received as'),
                      KChipBar<String>(
                        value: _mode,
                        options: _modes,
                        padding: EdgeInsets.zero,
                        onChanged: (v) {
                          if (!_loading) setState(() => _mode = v);
                        },
                      ),
                      const SizedBox(height: 18),
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _label('Payment date'),
                                Material(
                                  color: AppColors.sunken,
                                  borderRadius: BorderRadius.circular(AppRadius.md),
                                  child: InkWell(
                                    onTap: _loading ? null : _pickDate,
                                    borderRadius: BorderRadius.circular(AppRadius.md),
                                    child: SizedBox(
                                      height: 50,
                                      child: Row(
                                        children: [
                                          const SizedBox(width: 14),
                                          const Icon(LucideIcons.calendar, size: 16, color: AppColors.ink2),
                                          const SizedBox(width: 8),
                                          Text(ddMMyyyySlash(_paymentDate), style: AppText.body),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 18),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Expanded(
                            flex: 2,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _label('TDS deducted by customer'),
                                _input(_tds, placeholder: '0.00', number: true, onChanged: _onTdsChanged),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                _label('Section'),
                                WebFieldSelect<String>(
                                  value: _tdsSection,
                                  options: _tdsSections,
                                  enabled: !_loading && tdsEntered,
                                  onChanged: (v) => setState(() => _tdsSection = v),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'TDS settles the invoice and is booked to TDS Receivable; match it with Form 26AS.',
                        style: AppText.caption.copyWith(fontSize: 12),
                      ),
                      const SizedBox(height: 18),
                      _label('Reference / Transaction ID'),
                      _input(_reference, placeholder: 'Optional: UPI ID, cheque no., etc.'),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: KButton(label: 'Record Payment', icon: LucideIcons.check, loading: _loading, onPressed: _submit),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text, style: AppText.label),
      );

  Widget _input(TextEditingController c, {String? placeholder, bool number = false, bool big = false, ValueChanged<String>? onChanged}) {
    OutlineInputBorder border(Color color, [double w = 1.5]) =>
        OutlineInputBorder(borderRadius: BorderRadius.circular(AppRadius.md), borderSide: BorderSide(color: color, width: w));
    return TextField(
      controller: c,
      enabled: !_loading,
      onChanged: onChanged ?? (_) => setState(() {}),
      keyboardType: number ? const TextInputType.numberWithOptions(decimal: true) : TextInputType.text,
      inputFormatters: number ? [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))] : null,
      style: big ? AppText.amount.copyWith(fontSize: 24) : AppText.body,
      cursorColor: AppColors.brand,
      decoration: InputDecoration(
        hintText: placeholder,
        prefixText: big ? '$rupeeSign ' : null,
        prefixStyle: big ? AppText.amount.copyWith(fontSize: 22, color: AppColors.ink3) : null,
        isDense: true,
        filled: true,
        fillColor: AppColors.surface,
        hintStyle: AppText.body.copyWith(color: AppColors.ink3),
        contentPadding: EdgeInsets.symmetric(horizontal: 14, vertical: big ? 14 : 13),
        enabledBorder: border(AppColors.hairline),
        disabledBorder: border(AppColors.hairline),
        focusedBorder: border(AppColors.brand, 2),
      ),
    );
  }
}
