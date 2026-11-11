import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:printing/printing.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'report_period.dart';

/// Shows a PDF. Replaceable so a test can see the bytes without the platform viewer.
typedef PdfOpener = Future<void> Function(BuildContext context, List<int> bytes, String title);

/// `GET /api/reports/profit-loss/pdf` reads `from_date` and `to_date`, like the statement itself.
String profitLossPdfPath(ReportPeriod p) => '/api/reports/profit-loss/pdf?${p.query}';

/// `GET /api/reports/cash-flow/pdf` reads `from_date` and `to_date`.
String cashFlowPdfPath(ReportPeriod p) => '/api/reports/cash-flow/pdf?${p.query}';

/// `GET /api/reports/balance-sheet/pdf` reads `as_on_date`.
String balanceSheetPdfPath(DateTime asOn) => '/api/reports/balance-sheet/pdf?as_on_date=${ymd(asOn)}';

/// `GET /api/reports/trial-balance/pdf` reads `as_on_date`.
String trialBalancePdfPath(DateTime asOn) => '/api/reports/trial-balance/pdf?as_on_date=${ymd(asOn)}';

/// `GET /api/reports/profit-loss/drilldown`, as the website sends it: `line` is `account`
/// (with `account_ids`, comma separated, and the statement `section`), `purchases`,
/// `opening_stock` or `closing_stock`. `financial_year` is the statement's own, when it names one.
String plDrillPath(ReportPeriod p, List<String> accountIds, String? section, {String line = 'account', String? financialYear}) {
  final query = <String, String>{
    'from_date': p.fromIso,
    'to_date': p.toIso,
    'line': line,
    if (financialYear != null && financialYear.isNotEmpty) 'financial_year': financialYear,
    if (line == 'account') 'account_ids': accountIds.join(','),
    if (line == 'account' && section != null && section.isNotEmpty) 'section': section,
  };
  return Uri(path: '/api/reports/profit-loss/drilldown', queryParameters: query).toString();
}

/// An account's id followed by every sub-account's, as the website rolls them up.
List<String> plAccountSubtreeIds(Map account) {
  final ids = <String>[];
  void walk(Map node) {
    final id = node['id']?.toString() ?? '';
    if (id.isNotEmpty) ids.add(id);
    final children = node['children'];
    if (children is List) {
      for (final c in children.whereType<Map>()) {
        walk(c);
      }
    }
  }

  walk(account);
  return ids;
}

/// Share PDF for a statement screen: downloads [path] and hands the bytes to the viewer.
mixin StatementPdfSharing<T extends StatefulWidget> on State<T> {
  bool pdfBusy = false;

  Future<void> shareStatementPdf(AppSession session, String path, String title, {PdfOpener? openPdf}) async {
    if (pdfBusy) return;
    setState(() => pdfBusy = true);
    try {
      final bytes = await session.api.getBytes(path);
      if (!mounted) return;
      await (openPdf ?? openStatementPdfViewer)(context, bytes, title);
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not open the PDF. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => pdfBusy = false);
    }
  }
}

/// A file name the share sheet can use: letters, digits, dots and dashes.
String statementPdfFileName(String title) {
  final safe = title.replaceAll(RegExp(r'[^\w.-]+'), '_').replaceAll(RegExp(r'^_+|_+$'), '');
  return '${safe.isEmpty ? 'Statement' : safe}.pdf';
}

Future<void> openStatementPdfViewer(BuildContext context, List<int> bytes, String title) =>
    openPdfViewer(context, bytes, title: title, fileName: statementPdfFileName(title));

/// The one PDF viewer (print and share) used by the account statement and the financial statements.
Future<void> openPdfViewer(BuildContext context, List<int> bytes, {required String title, required String fileName}) {
  return Navigator.of(context).push(
    MaterialPageRoute<void>(builder: (_) => PdfViewerScreen(bytes: Uint8List.fromList(bytes), title: title, fileName: fileName)),
  );
}

class PdfViewerScreen extends StatelessWidget {
  const PdfViewerScreen({super.key, required this.bytes, required this.title, required this.fileName});

  final Uint8List bytes;
  final String title;
  final String fileName;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(title),
            Expanded(
              child: PdfPreview(
                build: (_) async => bytes,
                pdfFileName: fileName,
                canChangePageFormat: false,
                canChangeOrientation: false,
                canDebug: false,
                scrollViewDecoration: const BoxDecoration(color: AppColors.bg),
                actionBarTheme: PdfActionBarTheme(backgroundColor: AppColors.brand, iconColor: AppColors.onBrand),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
