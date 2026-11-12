import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_logic.dart';
import 'challan_logic.dart';

/// A yes/no question as a sheet. A double tap answers once. True only when [confirmLabel] was tapped.
Future<bool> askSheet(
  BuildContext context, {
  required String title,
  required String text,
  required String confirmLabel,
  required String cancelLabel,
  bool danger = true,
}) async {
  final ok = await showKSheet<bool>(
    context,
    title: title,
    builder: (ctx) => _AskSheet(text: text, confirmLabel: confirmLabel, cancelLabel: cancelLabel, danger: danger),
  );
  return ok == true;
}

class _AskSheet extends StatefulWidget {
  const _AskSheet({required this.text, required this.confirmLabel, required this.cancelLabel, required this.danger});

  final String text, confirmLabel, cancelLabel;
  final bool danger;

  @override
  State<_AskSheet> createState() => _AskSheetState();
}

class _AskSheetState extends State<_AskSheet> {
  bool _tapped = false;

  void _done(bool value) {
    if (_tapped) return;
    _tapped = true;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.text, style: AppText.body),
          const SizedBox(height: AppSpace.lg),
          KButton(label: widget.confirmLabel, kind: widget.danger ? KButtonKind.danger : KButtonKind.primary, onPressed: () => _done(true)),
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(label: widget.cancelLabel, onPressed: () => _done(false)),
        ],
      ),
    );
  }
}

/// The website's "Actual hours spent (optional)" prompt when completing a work order.
/// Null when closed; `hours` is null when left blank.
Future<({num? hours})?> askActualHours(BuildContext context, {num? current}) {
  return showKSheet<({num? hours})>(
    context,
    title: 'Actual hours spent',
    builder: (ctx) => _HoursSheet(current: current),
  );
}

class _HoursSheet extends StatefulWidget {
  const _HoursSheet({this.current});

  final num? current;

  @override
  State<_HoursSheet> createState() => _HoursSheetState();
}

class _HoursSheetState extends State<_HoursSheet> {
  late final _hours = TextEditingController(text: widget.current == null || widget.current == 0 ? '' : jsNumberString(widget.current!));
  String? _error;
  bool _tapped = false;

  @override
  void dispose() {
    _hours.dispose();
    super.dispose();
  }

  void _done() {
    if (_tapped) return;
    final text = _hours.text.trim();
    num? hours;
    if (text.isNotEmpty) {
      hours = num.tryParse(text);
      if (hours == null || !hours.isFinite || hours < 0) {
        setState(() => _error = 'Enter hours as a number, or leave it blank.');
        return;
      }
    }
    _tapped = true;
    Navigator.of(context).pop((hours: hours));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KTextField(
            label: 'Actual hours (optional)',
            controller: _hours,
            error: _error,
            keyboard: const TextInputType.numberWithOptions(decimal: true),
          ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Complete', onPressed: _done),
        ],
      ),
    );
  }
}

/// Goods coming back on a returnable challan (the website's `ChallanReturnPanel`): returned to the godown,
/// sold to the holder where they lie (approval, consignment), or lost while out. Pops with the settle body.
class ChallanReturnSheet extends StatefulWidget {
  const ChallanReturnSheet({super.key, required this.lines, required this.canSell, required this.challanDate});

  final List<Map<String, dynamic>> lines;
  final bool canSell;
  final DateTime? challanDate;

  @override
  State<ChallanReturnSheet> createState() => _ChallanReturnSheetState();
}

class _Entry {
  _Entry(String open)
      : returned = TextEditingController(text: open),
        invoiced = TextEditingController(),
        lost = TextEditingController();

  final TextEditingController returned, invoiced, lost;

  void dispose() {
    returned.dispose();
    invoiced.dispose();
    lost.dispose();
  }
}

class _ChallanReturnSheetState extends State<ChallanReturnSheet> {
  late final List<_Entry> _entries = [for (final l in widget.lines) _Entry(jsNumberString(docNum(l['qty_open']) ?? 0))];
  final _notes = TextEditingController();
  DateTime _date = DateTime.now();
  String _reason = 'CUSTODY_LOSS';
  String? _error;
  bool _tapped = false;

  @override
  void dispose() {
    for (final e in _entries) {
      e.dispose();
    }
    _notes.dispose();
    super.dispose();
  }

  num _q(TextEditingController c) {
    final v = num.tryParse(c.text.trim()) ?? 0;
    return v.isFinite && v > 0 ? v : 0;
  }

  bool get _anyLost => _entries.any((e) => _q(e.lost) > 0);

  void _save() {
    if (_tapped) return;
    final entries = [
      for (var i = 0; i < widget.lines.length; i++)
        ChallanReturnEntry(
          lineId: docText(widget.lines[i]['id']),
          returned: _q(_entries[i].returned),
          invoiced: widget.canSell ? _q(_entries[i].invoiced) : 0,
          writtenOff: _q(_entries[i].lost),
        ),
    ];
    if (entries.every((e) => e.isEmpty)) {
      setState(() => _error = 'Enter what came back');
      return;
    }
    _tapped = true;
    Navigator.of(context).pop(challanReturnBody(date: _date, entries: entries, reason: _reason, notes: _notes.text));
  }

  @override
  Widget build(BuildContext context) {
    final qtyField = const TextInputType.numberWithOptions(decimal: true);
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KDateField(label: 'Date', value: _date, first: widget.challanDate, last: DateTime.now().add(const Duration(days: 1)), onChanged: (d) => setState(() => _date = d)),
          if (widget.lines.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.lg),
              child: Text('Nothing is still out on this challan.', style: AppText.body),
            ),
          for (var i = 0; i < widget.lines.length; i++) ...[
            const SizedBox(height: AppSpace.lg),
            Text(docText(widget.lines[i]['item_name']), style: AppText.bodyStrong),
            Text(
              '${jsNumberString(docNum(widget.lines[i]['qty_open']) ?? 0)} of ${jsNumberString(docNum(widget.lines[i]['qty']) ?? 0)} ${docText(widget.lines[i]['unit'])} still out',
              style: AppText.caption,
            ),
            const SizedBox(height: AppSpace.sm),
            KTextField(label: 'Came back', controller: _entries[i].returned, keyboard: qtyField, onChanged: (_) => setState(() {})),
            if (widget.canSell) ...[
              const SizedBox(height: AppSpace.sm),
              KTextField(label: 'Sold to holder', controller: _entries[i].invoiced, keyboard: qtyField),
            ],
            const SizedBox(height: AppSpace.sm),
            KTextField(label: 'Lost or destroyed', controller: _entries[i].lost, keyboard: qtyField, onChanged: (_) => setState(() {})),
          ],
          if (widget.canSell)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.md),
              child: Text(
                'Goods sold to the holder come back onto the godown stock here; raise the invoice next and it takes them out.',
                style: AppText.caption,
              ),
            ),
          if (_anyLost) ...[
            const SizedBox(height: AppSpace.lg),
            KPickField<String>(label: 'Why they were lost', value: _reason, options: kWriteOffReasons, onChanged: (v) => setState(() => _reason = v)),
            const SizedBox(height: AppSpace.sm),
            KTextField(label: 'Note', controller: _notes, hint: 'What happened'),
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.sm),
              child: Text('The loss is written off at cost and its input tax credit is reversed.', style: AppText.caption),
            ),
          ],
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpace.md),
              child: Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
            ),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Save return', onPressed: widget.lines.isEmpty ? null : _save),
        ],
      ),
    );
  }
}

/// Shares a document's PDF (`GET /api/documents/[table]/[id]/pdf`, the website's Print and PDF).
Future<bool?> shareDocumentPdf(
  BuildContext context,
  AppSession session, {
  required String table,
  required String id,
  required String number,
  required String filePrefix,
  required String subject,
}) async {
  try {
    final bytes = await session.api.getBytes('/api/documents/$table/$id/pdf');
    final dir = await getTemporaryDirectory();
    final safe = number.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final file = File('${dir.path}/$filePrefix-$safe.pdf');
    await file.writeAsBytes(bytes);
    await SharePlus.instance.share(ShareParams(files: [XFile(file.path)], subject: subject));
  } on ApiException catch (e) {
    if (context.mounted) showKToast(context, e.message, tone: KTone.negative);
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not share the document. Try again.', tone: KTone.negative);
  }
  return null;
}
