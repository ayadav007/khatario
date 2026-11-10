import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import '../docs/doc_detail_screen.dart';
import '../docs/doc_list_screen.dart';
import '../docs/doc_logic.dart';
import '../purchases/bill_form_screen.dart';
import 'doc_action_sheets.dart';
import 'note_logic.dart';

/// `app/(app)/credit-notes/page.tsx` and `app/(app)/debit-notes/page.tsx`, one screen with a [debit] flag.
/// `GET /api/credit-notes` replies `{ creditNotes, pagination }` (Show more reads the next page);
/// `GET /api/debit-notes` replies `{ debitNotes }` in one piece. Open shows the note; long-press offers
/// Cancel (while it is active) and Share. New opens the phone's note form.
class CreditDebitNotesScreen extends StatelessWidget {
  const CreditDebitNotesScreen({super.key, required this.session, this.debit = false});

  final AppSession session;
  final bool debit;

  /// The note page. The list reloads when it closes with a change (a cancel).
  Future<bool?> _open(BuildContext context, Map<String, dynamic> row) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => NoteDetailScreen(session: session, seed: row, debit: debit)),
    );
    return changed == true;
  }

  @override
  Widget build(BuildContext context) {
    final noun = debit ? 'debit note' : 'credit note';
    return DocListScreen(
      session: session,
      spec: DocListSpec(
        title: debit ? 'Debit notes' : 'Credit notes',
        href: debit ? '/debit-notes' : '/credit-notes',
        path: debit ? '/api/debit-notes' : '/api/credit-notes',
        listKey: debit ? 'debitNotes' : 'creditNotes',
        titleOf: (r) => noteTitle(r, debit: debit),
        subtitleOf: (r) => noteSubtitle(r, debit: debit),
        amountOf: (r) => docNum(r['grand_total']),
        statusOf: (r) => noteStatus(r, debit: debit),
        searchKeys: [debit ? 'debit_note_number' : 'credit_note_number', 'customer_name', 'invoice_number'],
        icon: debit ? LucideIcons.fileUp : LucideIcons.fileDown,
        emptyTitle: 'No ${noun}s yet',
        emptyBody: debit
            ? 'Record additional charges or upward adjustments against a customer.'
            : 'Record a sales return or a post-sale discount to reduce what a customer owes.',
        createLabel: 'New $noun',
        onCreate: (ctx) => Navigator.of(ctx).push<bool>(
          MaterialPageRoute(builder: (_) => BillFormScreen(session: session, kind: debit ? BillKind.debitNote : BillKind.creditNote)),
        ),
        onOpen: _open,
        rowActions: (row) => [for (final a in noteActions(row)) _action(session, row, a, debit)],
      ),
    );
  }
}

DocAction _action(AppSession session, Map<String, dynamic> row, NoteAction a, bool debit) {
  final noun = debit ? 'debit note' : 'credit note';
  return switch (a) {
    NoteAction.cancel => DocAction('Cancel $noun', LucideIcons.circleX, (ctx) => cancelNote(ctx, session, row, debit: debit), danger: true),
    NoteAction.share => DocAction('Share', LucideIcons.share2, (ctx) => shareNote(ctx, session, row, debit: debit)),
  };
}

/// Shares the note's PDF (`GET /api/documents/credit_notes|debit_notes/[id]/pdf`, the website's PDF button).
Future<bool?> shareNote(BuildContext context, AppSession session, Map<String, dynamic> row, {required bool debit}) {
  final number = noteTitle(row, debit: debit);
  return shareDocumentPdf(
    context,
    session,
    table: debit ? 'debit_notes' : 'credit_notes',
    id: docText(row['id']),
    number: number,
    filePrefix: debit ? 'DebitNote' : 'CreditNote',
    subject: '${debit ? 'Debit' : 'Credit'} note $number',
  );
}

/// A cancel runs at most once at a time per note.
final _inFlight = <String>{};

/// Asks for a reason (naming the note and amount), then `PATCH /api/credit-notes|debit-notes/[id]/cancel`
/// with `{ reason }` once. True when the note was cancelled or the server says it already is (409
/// already-cancelled: reload). Null on no, a repeat tap, or any other refusal (a GST-filed or locked period,
/// a credit already used on an invoice, ...): the server's message is a toast and nothing changed.
Future<bool?> cancelNote(BuildContext context, AppSession session, Map<String, dynamic> row, {required bool debit}) async {
  final id = docText(row['id']);
  final key = '${debit ? 'dn' : 'cn'}:$id';
  if (!_inFlight.add(key)) return null;
  try {
    final number = noteTitle(row, debit: debit);
    final reason = await showKSheet<String>(
      context,
      title: 'Cancel $number?',
      scrollable: true,
      builder: (ctx) => _CancelNoteSheet(text: noteCancelText(number, docNum(row['grand_total']) ?? 0, debit: debit), debit: debit),
    );
    final body = reason == null ? null : noteCancelBody(reason);
    if (body == null || !context.mounted) return null;
    await session.api.patchJson('/api/${debit ? 'debit' : 'credit'}-notes/$id/cancel', body);
    if (context.mounted) showKToast(context, noteCancelledToast(number, debit: debit), tone: KTone.positive);
    return true;
  } on ApiException catch (e) {
    final already = (e.code ?? '').endsWith('ALREADY_CANCELLED');
    if (context.mounted) {
      showKToast(context, already ? 'This ${debit ? 'debit' : 'credit'} note was already cancelled.' : e.message, tone: already ? KTone.neutral : KTone.negative);
    }
    return already ? true : null;
  } catch (_) {
    if (context.mounted) showKToast(context, 'Could not cancel the ${debit ? 'debit' : 'credit'} note', tone: KTone.negative);
    return null;
  } finally {
    _inFlight.remove(key);
  }
}

/// The cancel question with a required reason. Pops with the reason once; a double tap answers once.
class _CancelNoteSheet extends StatefulWidget {
  const _CancelNoteSheet({required this.text, required this.debit});

  final String text;
  final bool debit;

  @override
  State<_CancelNoteSheet> createState() => _CancelNoteSheetState();
}

class _CancelNoteSheetState extends State<_CancelNoteSheet> {
  final _reason = TextEditingController();
  String? _error;
  bool _tapped = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _done(String? value) {
    if (_tapped) return;
    if (value != null && noteCancelBody(value) == null) {
      setState(() => _error = 'Say why you are cancelling it.');
      return;
    }
    _tapped = true;
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    final noun = widget.debit ? 'debit note' : 'credit note';
    return Padding(
      padding: const EdgeInsets.fromLTRB(AppSpace.gutter, 0, AppSpace.gutter, AppSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.text, style: AppText.body),
          const SizedBox(height: AppSpace.lg),
          KTextField(label: 'Reason for cancelling', controller: _reason, error: _error, maxLines: 3, onChanged: (_) => setState(() => _error = null)),
          const SizedBox(height: AppSpace.lg),
          KButton(label: 'Cancel $noun', kind: KButtonKind.danger, onPressed: () => _done(_reason.text)),
          const SizedBox(height: AppSpace.sm),
          KButton.secondary(label: 'Keep $noun', onPressed: () => _done(null)),
        ],
      ),
    );
  }
}

/// The note page: `GET /api/documents/credit_notes|debit_notes/[id]` (`{ document, items }`, the route the
/// website's detail page reads; the list route has no GET by id). The list row is drawn first. The page
/// has no Edit (the server refuses `PUT`/`PATCH` with 405); Cancel and Share are under More.
class NoteDetailScreen extends StatelessWidget {
  const NoteDetailScreen({super.key, required this.session, this.seed, this.noteId, this.debit = false});

  final AppSession session;
  final Map<String, dynamic>? seed;
  final String? noteId;
  final bool debit;

  String get _id => noteId ?? docText(seed?['id']);

  Future<Map<String, dynamic>> _load(KhatarioApi api) async {
    final body = await api.getJson('/api/documents/${debit ? 'debit_notes' : 'credit_notes'}/$_id');
    final raw = body['document'];
    if (raw is! Map) throw ApiException('${debit ? 'Debit' : 'Credit'} note not found');
    // The list row carries the customer's name and the invoice number the document route does not join.
    final doc = <String, dynamic>{...?seed, ...Map<String, dynamic>.from(raw)};
    if (docText(doc['customer_name']).isEmpty) doc['customer_name'] = docText(doc['party_name']);
    doc['items'] = docRows(body, 'items');
    // Opened by id alone, the document has `invoice_id` but not the invoice's number: read it, or leave it out.
    final invoiceId = docText(doc['invoice_id']);
    if (invoiceId.isNotEmpty && docText(doc['invoice_number']).isEmpty) {
      try {
        final inv = (await api.getJson('/api/invoices/$invoiceId'))['invoice'];
        if (inv is Map) doc['invoice_number'] = docText(inv['invoice_number']);
      } catch (_) {}
    }
    return doc;
  }

  @override
  Widget build(BuildContext context) {
    return DocDetailScreen(
      session: session,
      seed: seed,
      spec: DocDetailSpec(
        title: debit ? 'Debit note' : 'Credit note',
        load: _load,
        numberOf: (d) => noteTitle(d, debit: debit),
        statusOf: (d) => noteStatus(d, debit: debit),
        partyOf: (d) => docText(d['customer_name']),
        amountOf: (d) => docNum(d['grand_total']),
        facts: (d) {
          final date = docDate(d[debit ? 'debit_note_date' : 'credit_note_date']);
          final original = docDate(d['original_invoice_date']);
          final period = !debit && noteIsDiscount(d) ? noteSupplyPeriod(d) : null;
          final status = docText(d[debit ? 'adjustment_status' : 'refund_status']);
          return [
            ('Date', date == null ? '' : ddMMMyyyy(date)),
            if (!debit) ('Type', noteIsDiscount(d) ? 'Post-sale discount' : 'Sales return'),
            ('Supply period', period ?? ''),
            ('Invoice', docText(d['invoice_number'])),
            ('Invoice date', original == null ? '' : ddMMMyyyy(original)),
            (debit ? 'Adjustment' : 'Refund', status.isEmpty ? '' : statusTone(status).$2),
            ('Reason', docText(d['reason'])),
            ('Cancelled because', noteIsCancelled(d) ? docText(d['cancellation_reason']) : ''),
            ('Notes', docText(d['notes'])),
          ];
        },
        lines: (d) => [
          for (final l in docRows(d, 'items'))
            DocLine(
              [docText(l['item_name']), docText(l['description'])].firstWhere((e) => e.isNotEmpty, orElse: () => 'Item'),
              subtitle: noteLineSubtitle(l),
              amount: docNum(l['line_total']),
            ),
        ],
        totals: (d) {
          num? shown(String key) {
            final v = docNum(d[key]);
            return v == null || v.abs() < 0.0001 ? null : v;
          }

          return [
            ('Taxable value', docNum(d['subtotal'])),
            ('CGST', shown('cgst_total')),
            ('SGST', shown('sgst_total')),
            ('IGST', shown('igst_total')),
            ('Round off', shown('round_off')),
            ('Total', docNum(d['grand_total'])),
          ];
        },
        actions: (d) => [for (final a in noteActions(d)) _action(session, d, a, debit)],
      ),
    );
  }
}
