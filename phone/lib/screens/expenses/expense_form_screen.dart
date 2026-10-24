import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';

/// `app/(app)/expenses/new/page.tsx`. The session user is the actor.
class ExpenseFormScreen extends StatefulWidget {
  const ExpenseFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<ExpenseFormScreen> createState() => _ExpenseFormScreenState();
}

class _ExpenseFormScreenState extends State<ExpenseFormScreen> {
  final _amount = TextEditingController();
  final _description = TextEditingController();
  DateTime _date = DateTime.now();
  String _mode = 'cash';
  bool _saving = false;

  @override
  void dispose() {
    _amount.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amount.text) ?? 0;
    if (amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter an amount')));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.session.api.postJson('/api/expenses', {
        'amount': amount,
        'description': _description.text.trim().isEmpty ? null : _description.text.trim(),
        'expense_date': '${_date.year.toString().padLeft(4, '0')}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}',
        'payment_mode': _mode,
      });
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('New expense')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(controller: _amount, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount *')),
          TextField(controller: _description, decoration: const InputDecoration(labelText: 'Description'), maxLines: 2),
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Date'),
            subtitle: Text(ddMMMyyyy(_date)),
            onTap: () async {
              final picked = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2000), lastDate: DateTime(2100));
              if (picked != null) setState(() => _date = picked);
            },
          ),
          DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: _mode,
            decoration: const InputDecoration(labelText: 'Payment mode'),
            items: const [
              DropdownMenuItem(value: 'cash', child: Text('Cash')),
              DropdownMenuItem(value: 'upi', child: Text('UPI')),
              DropdownMenuItem(value: 'bank', child: Text('Bank')),
              DropdownMenuItem(value: 'on_account', child: Text('On account')),
            ],
            onChanged: (v) => setState(() => _mode = v ?? 'cash'),
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving...' : 'Save expense')),
        ],
      ),
    );
  }
}
