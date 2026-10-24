import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';

/// Two-line journal. The server rejects a draft unless debits equal credits.
class JournalFormScreen extends StatefulWidget {
  const JournalFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<JournalFormScreen> createState() => _JournalFormScreenState();
}

class _JournalLine {
  String? accountId;
  final amount = TextEditingController();
  bool debit = true;

  void dispose() => amount.dispose();
}

class _JournalFormScreenState extends State<JournalFormScreen> {
  final _narration = TextEditingController();
  final _reference = TextEditingController();
  final _lines = [_JournalLine(), _JournalLine()];
  DateTime _date = DateTime.now();
  List<Map<String, dynamic>> _accounts = const [];
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadAccounts();
  }

  @override
  void dispose() {
    _narration.dispose();
    _reference.dispose();
    for (final line in _lines) {
      line.dispose();
    }
    super.dispose();
  }

  Future<void> _loadAccounts() async {
    try {
      final body = await widget.session.api.getData('/api/accounts');
      final rows = recordsFromAccounts(body);
      if (mounted) setState(() { _accounts = rows; _loading = false; });
    } on ApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    }
  }

  Future<void> _save() async {
    final lines = <Map<String, dynamic>>[];
    var debit = 0.0;
    var credit = 0.0;
    for (final line in _lines) {
      final amount = double.tryParse(line.amount.text) ?? 0;
      if (line.accountId == null || amount <= 0) {
        setState(() => _error = 'Each line needs an account and an amount.');
        return;
      }
      if (line.debit) {
        debit += amount;
      } else {
        credit += amount;
      }
      lines.add({
        'account_id': line.accountId,
        'debit': line.debit ? amount : 0,
        'credit': line.debit ? 0 : amount,
      });
    }
    if ((debit - credit).abs() > 0.009) {
      setState(() => _error = 'Debits and credits must match.');
      return;
    }
    setState(() { _saving = true; _error = null; });
    try {
      await widget.session.api.postJson('/api/journal-entries', {
        'branch_id': widget.session.defaultBranchId,
        'entry_date': isoDate(_date),
        'reference_number': _reference.text.trim(),
        'narration': _narration.text.trim(),
        'lines': lines,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(body: KSpinner(padding: EdgeInsets.symmetric(vertical: 64)));
    return Scaffold(
      backgroundColor: AppColors.bg,
      appBar: AppBar(title: const Text('New journal entry')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Date'),
            subtitle: Text(ddMMMyyyy(_date)),
            onTap: () async {
              final picked = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2000), lastDate: DateTime(2100));
              if (picked != null) setState(() => _date = picked);
            },
          ),
          TextField(controller: _reference, decoration: const InputDecoration(labelText: 'Reference')),
          TextField(controller: _narration, decoration: const InputDecoration(labelText: 'Narration')),
          const SizedBox(height: 16),
          for (var i = 0; i < _lines.length; i++) _line(i),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: AppText.body.copyWith(color: AppColors.negative)),
          ],
          const SizedBox(height: 16),
          KButton(label: _saving ? 'Saving…' : 'Post entry', onPressed: _saving || _accounts.isEmpty ? null : _save),
        ],
      ),
    );
  }

  Widget _line(int index) {
    final line = _lines[index];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: KCard(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              DropdownButtonFormField<String>(
                isExpanded: true,
                initialValue: line.accountId,
                decoration: InputDecoration(labelText: 'Account ${index + 1}'),
                items: [
                  for (final account in _accounts)
                    DropdownMenuItem(value: account['id']?.toString(), child: Text(account['name']?.toString() ?? 'Account')),
                ],
                onChanged: (value) => setState(() => line.accountId = value),
              ),
              TextField(
                controller: line.amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Amount'),
              ),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: Text(line.debit ? 'Debit' : 'Credit'),
                value: line.debit,
                activeTrackColor: AppColors.brand,
                onChanged: (value) => setState(() => line.debit = value),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

List<Map<String, dynamic>> recordsFromAccounts(dynamic body) {
  if (body is Map && body['accounts'] is List) {
    return (body['accounts'] as List).whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
  }
  if (body is List) return body.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList();
  return const [];
}

String isoDate(DateTime date) =>
    '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';
