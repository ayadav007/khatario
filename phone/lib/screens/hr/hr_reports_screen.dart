import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../reports/gst_kit.dart';
import 'attendance_leave_logic.dart';
import 'hr_more_logic.dart';
import 'pay_widgets.dart';

const _monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/// Website `/hr/reports`: the HR exports. Every one of the website's report routes (and the statutory
/// PF/ESI "ECR" helper) answers with a CSV file, not a table, so each row downloads its file for the
/// chosen year and month and hands it to the share sheet. The routes' own query names are used.
class HrReportsScreen extends StatefulWidget {
  const HrReportsScreen({super.key, required this.session, this.now, this.shareFile = shareGstFile, this.reports = hrReports});

  final AppSession session;

  /// Today, for the default month (tests fix it).
  final DateTime? now;

  /// Where the downloaded file goes (the share sheet); tests replace it.
  final GstShareFile shareFile;
  final List<HrReportDef> reports;

  @override
  State<HrReportsScreen> createState() => _HrReportsScreenState();
}

class _HrReportsScreenState extends State<HrReportsScreen> {
  late final DateTime _today = widget.now ?? DateTime.now();
  late int _year = _today.year;
  late int _month = _today.month;
  HrAccess? _access;
  String? _busy;

  @override
  void initState() {
    super.initState();
    loadHrAccess(widget.session).then((a) {
      if (mounted) setState(() => _access = a);
    });
  }

  Future<void> _download(HrReportDef r) async {
    if (_busy != null) return;
    setState(() => _busy = r.id);
    try {
      final bytes = await widget.session.api.getBytes(hrReportPath(r, _year, _month));
      if (!mounted) return;
      await widget.shareFile(bytes, hrReportFileName(r, _year, _month, _today));
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Download failed. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final access = _access;
    final inPlan = access == null || access.has('hr_advanced');
    return PayListPage(
      title: 'HR reports',
      loading: access == null,
      error: inPlan ? null : 'HR reports are part of the advanced HR plan.',
      notInPlan: !inPlan,
      onRetry: () async {},
      emptyTitle: 'No reports',
      emptyBody: 'Nothing to export.',
      emptyIcon: LucideIcons.fileSpreadsheet,
      header: [
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.sm),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            KPickField<int>(label: 'Year', value: _year, options: [for (final y in [_today.year - 1, _today.year, _today.year + 1]) (y, '$y')], onChanged: (v) => setState(() => _year = v)),
            const SizedBox(height: AppSpace.sm),
            KPickField<int>(label: 'Month', value: _month, options: [for (var m = 1; m <= 12; m++) (m, _monthNames[m - 1])], onChanged: (v) => setState(() => _month = v)),
            const SizedBox(height: AppSpace.xs),
            Text('Month applies to attendance, payroll, overtime and the statutory file. Leave reports use the year only.', style: AppText.caption),
          ]),
        ),
      ],
      rows: [
        for (final r in widget.reports)
          KCard(
            padding: const EdgeInsets.all(14),
            child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(r.title, style: AppText.bodyStrong),
                  const SizedBox(height: 2),
                  Text(r.description, style: AppText.small),
                ]),
              ),
              const SizedBox(width: AppSpace.sm),
              PayRowButton(key: ValueKey('download-${r.id}'), label: 'Download CSV', busy: _busy == r.id, onTap: _busy == null ? () => _download(r) : null),
            ]),
          ),
      ],
    );
  }
}
