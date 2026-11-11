import 'dart:io';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../accounting/assets_tds_widgets.dart';
import '../pages/website_page_screen.dart';
import 'statement_kit.dart';
import 'table_report_screen.dart';

/// What the GST screens share: the load / refresh / error states, a tile grid, the figure sheet, the website
/// hand-off and the action runner. A GST screen mixes [GstLoader] into its state and lists what it draws.

/// Hands a downloaded file to the phone's share sheet. Tests replace it.
typedef GstShareFile = Future<void> Function(List<int> bytes, String filename);

Future<void> shareGstFile(List<int> bytes, String filename) async {
  final dir = await getTemporaryDirectory();
  final file = File('${dir.path}/$filename');
  await file.writeAsBytes(bytes);
  await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], subject: filename));
}

/// Runs a request the user asked for. The server's refusal (or a plain network message) shows in a toast and the
/// screen stays as it is. True when the request went through.
Future<bool> gstAct(BuildContext context, Future<void> Function() request) async {
  try {
    await request();
    return true;
  } catch (e) {
    if (context.mounted) showKToast(context, actionProblemOf(e), tone: KTone.negative);
    return false;
  }
}

/// Loads one reply (and optionally a second, which may fail without hiding the first), with the states every
/// GST screen has: spinner, "Try again", plan and access messages, and a pull to refresh that keeps the screen.
mixin GstLoader<T extends StatefulWidget> on State<T> {
  AppSession get gstSessionOf;

  /// "GSTR-1": used in "Could not load GSTR-1".
  String get gstWhat;

  /// The title bar.
  String get gstTitle;

  /// The request for the current period and filters.
  String gstPath();

  /// A second request made after the first succeeded. A failure leaves [gstExtra] null.
  Future<dynamic> gstLoadExtra(dynamic body) async => null;

  dynamic gstBody;
  dynamic gstExtra;
  bool gstLoading = true;
  LoadProblem? gstProblem;
  int _gstSeq = 0;

  Future<void> gstLoad({bool spinner = true}) async {
    final seq = ++_gstSeq;
    if (spinner) {
      setState(() {
        gstLoading = true;
        gstProblem = null;
      });
    }
    try {
      final body = await gstSessionOf.api.getData(gstPath());
      dynamic extra;
      try {
        extra = await gstLoadExtra(body);
      } catch (_) {
        extra = null;
      }
      if (!mounted || seq != _gstSeq) return;
      setState(() {
        gstBody = body;
        gstExtra = extra;
        gstLoading = false;
        gstProblem = null;
      });
    } catch (e) {
      if (!mounted || seq != _gstSeq) return;
      final problem = loadProblemOf(e);
      if (!spinner && gstBody != null && !gstLoading && gstProblem == null) return showKToast(context, problem.message, tone: KTone.negative);
      setState(() {
        gstProblem = problem;
        gstLoading = false;
      });
    }
  }

  /// Bar, period and filter rows, then the list of [children] (built only when a reply is on screen).
  Widget gstScaffold({Widget? periodBar, Widget? filterBar, required List<Widget> Function() children, Widget? bottom}) {
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            KBackBar(gstTitle),
            ?periodBar,
            ?filterBar,
            Expanded(child: _gstContent(children)),
            ?bottom,
          ],
        ),
      ),
    );
  }

  Widget _gstContent(List<Widget> Function() children) {
    if (gstLoading) return const KSpinner(padding: EdgeInsets.symmetric(vertical: 64));
    final problem = gstProblem;
    if (problem != null) return LoadProblemView(problem: problem, what: gstWhat, onRetry: gstLoad);
    return RefreshIndicator(
      color: AppColors.brand,
      onRefresh: () => gstLoad(spinner: false),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xxl),
        children: children(),
      ),
    );
  }
}

/// Two-column headline tiles: (label, text). The text is a figure the server sent, already formatted.
class GstTiles extends StatelessWidget {
  const GstTiles({super.key, required this.tiles});

  final List<(String label, String value)> tiles;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < tiles.length; i += 2) ...[
          if (i > 0) const SizedBox(height: AppSpace.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _tile(tiles[i])),
              const SizedBox(width: AppSpace.md),
              Expanded(child: i + 1 < tiles.length ? _tile(tiles[i + 1]) : const SizedBox.shrink()),
            ],
          ),
        ],
      ],
    );
  }

  Widget _tile((String, String) tile) => KCard(
        padding: const EdgeInsets.all(AppSpace.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(tile.$1, style: AppText.caption, maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: AppSpace.xs),
            Text(tile.$2, style: AppText.amount, maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ),
      );
}

/// A titled card of (label, value) rows, as a sheet or inline.
class GstFigureRows extends StatelessWidget {
  const GstFigureRows({super.key, required this.rows});

  final List<(String label, String value)> rows;

  @override
  Widget build(BuildContext context) {
    return KDivided(children: [
      for (final (label, value) in rows)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpace.md),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: Text(label, style: AppText.caption)),
              const SizedBox(width: AppSpace.md),
              Flexible(child: Text(value, textAlign: TextAlign.end, style: AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular))),
            ],
          ),
        ),
    ]);
  }
}

/// A sheet with a title, figure rows and optional extra widgets underneath.
Future<T?> showGstSheet<T>(
  BuildContext context, {
  required String title,
  List<(String, String)> rows = const [],
  List<Widget> before = const [],
  List<Widget> after = const [],
}) {
  return showKSheet<T>(
    context,
    title: title,
    scrollable: true,
    builder: (_) => Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.xl, AppSpace.sm, AppSpace.xl, AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ...before,
          if (rows.isNotEmpty) GstFigureRows(rows: rows),
          if (after.isNotEmpty) ...[const SizedBox(height: AppSpace.lg), ...after],
        ],
      ),
    ),
  );
}

/// Opens a website page inside the app for what the phone does not do (a file upload, a decision form).
class GstWebsiteButton extends StatelessWidget {
  const GstWebsiteButton({super.key, required this.session, required this.label, required this.href, this.title});

  final AppSession session;
  final String label, href;
  final String? title;

  @override
  Widget build(BuildContext context) {
    return KButton.secondary(label: label, onPressed: () => openWebsiteInApp(context, session, href, title ?? label));
  }
}

/// One statement-style card for a GST table row: its label over the five tax figures. [data] is the reply object;
/// a missing figure is left out, a zero figure too (see [StatementSection]).
Widget gstTaxRowCard(String label, dynamic data, List<(String, String)> heads) {
  final map = data is Map ? data : const {};
  return StatementSection(
    title: label,
    emptyText: 'Nil',
    signed: false,
    lines: [for (final (name, key) in heads) (label: name, amount: toNum(map[key]))],
  );
}

/// A row of a table as a [KListRow] card.
Widget gstRowCard(List<Widget> rows) => KCard(child: KDivided(children: rows));

/// The error line when a list is empty.
Widget gstEmpty(String title, {String? body}) => KEmptyState(icon: LucideIcons.fileText, title: title, body: body);

/// Hook for `reportCellText`, re-exported so the screens import one place.
String gstMoney(dynamic v) => reportCellText(v, money: true);

/// Asks for a short reason in a sheet. Returns the trimmed text ('' when left blank), or null when the sheet is
/// closed. The sheet owns its field, so closing it never leaves a rebuild running on a disposed controller.
Future<String?> showGstReasonSheet(
  BuildContext context, {
  required String title,
  required String confirmLabel,
  String label = 'Reason',
  String? hint,
  bool danger = true,
}) {
  return showKSheet<String>(
    context,
    title: title,
    builder: (_) => _ReasonBody(label: label, hint: hint, confirmLabel: confirmLabel, danger: danger),
  );
}

class _ReasonBody extends StatefulWidget {
  const _ReasonBody({required this.label, required this.hint, required this.confirmLabel, required this.danger});

  final String label, confirmLabel;
  final String? hint;
  final bool danger;

  @override
  State<_ReasonBody> createState() => _ReasonBodyState();
}

class _ReasonBodyState extends State<_ReasonBody> {
  final _text = TextEditingController();
  bool _done = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _pop() {
    if (_done) return;
    _done = true;
    Navigator.of(context).pop(_text.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.xl, AppSpace.xs, AppSpace.xl, AppSpace.sm),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KTextField(label: widget.label, controller: _text, hint: widget.hint, maxLines: 3, minLines: 1),
          const SizedBox(height: AppSpace.md),
          KButton(label: widget.confirmLabel, kind: widget.danger ? KButtonKind.danger : KButtonKind.primary, onPressed: _pop),
        ],
      ),
    );
  }
}
