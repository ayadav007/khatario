import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart' hide inr;
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../reports/statement_pdf.dart';
import 'pay_logic.dart';
import 'salary_payments_logic.dart';

/// Website `/employees/salary/payslips/[id]`: one salary payment and its payslip. The figures are the
/// server's (from the payments list); the payslip itself is the server's PDF, opened in the shared
/// viewer with Print and Share.
class PayslipScreen extends StatefulWidget {
  const PayslipScreen({super.key, required this.session, required this.payment});

  final AppSession session;
  final SalaryPaymentRow payment;

  @override
  State<PayslipScreen> createState() => _PayslipScreenState();
}

class _PayslipScreenState extends State<PayslipScreen> {
  bool _opening = false;

  Future<void> _open() async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      final bytes = await widget.session.api.getBytes(payslipPdfPath(widget.payment.id));
      if (!mounted) return;
      final r = widget.payment;
      await openPdfViewer(context, bytes, title: 'Payslip ${r.employeeName}', fileName: 'Payslip-${r.employeeName.replaceAll(' ', '-')}-${r.month}.pdf');
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not open the payslip. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = widget.payment;
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const KBackBar('Payslip'),
          Expanded(
            child: ListView(padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, 32), children: [
              KCard(
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    KAvatar(name: r.employeeName, size: 40),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(r.employeeName, style: AppText.heading),
                        Text([if (r.code != null && r.code!.isNotEmpty) r.code!, salaryMonthLabel(r.month)].join(' · '), style: AppText.caption),
                      ]),
                    ),
                  ]),
                  const SizedBox(height: 14),
                  _line('Gross salary', inr(r.gross, maxFraction: 2)),
                  _line('Total deductions', inr(r.deductions, maxFraction: 2)),
                  const Divider(height: 20),
                  _line('Net salary', inr(r.net, maxFraction: 2), strong: true),
                  const SizedBox(height: 6),
                  Text([if (r.paidOn != null) 'Paid ${dMMM(r.paidOn!)}', salaryStatusLabel(r.status)].join(' · '), style: AppText.caption),
                ]),
              ),
              const SizedBox(height: AppSpace.md),
              KButton(label: 'Open payslip PDF', icon: LucideIcons.fileText, loading: _opening, onPressed: _opening ? null : _open),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _line(String label, String value, {bool strong = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(children: [
          Expanded(child: Text(label, style: strong ? AppText.bodyStrong : AppText.body)),
          Text(value, style: strong ? AppText.bodyStrong : AppText.body),
        ]),
      );
}
