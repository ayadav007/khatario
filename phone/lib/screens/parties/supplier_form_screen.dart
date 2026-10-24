import 'package:flutter/material.dart';

import '../../api.dart';
import '../../session.dart';
import 'customer_form_logic.dart';

/// `app/(app)/suppliers/new/page.tsx`. Identity stays in the session.
class SupplierFormScreen extends StatefulWidget {
  const SupplierFormScreen({super.key, required this.session});

  final AppSession session;

  @override
  State<SupplierFormScreen> createState() => _SupplierFormScreenState();
}

class _SupplierFormScreenState extends State<SupplierFormScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _gstin = TextEditingController();
  String _state = 'Karnataka';
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    _gstin.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Name is required')));
      return;
    }
    final gstin = _gstin.text.trim();
    if (gstin.isNotEmpty && !isValidGstin(gstin)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a valid GSTIN')));
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.session.api.postJson('/api/suppliers', {
        'name': _name.text.trim(),
        'phone': _phone.text.trim().isEmpty ? null : _phone.text.trim(),
        'email': _email.text.trim().isEmpty ? null : _email.text.trim(),
        'gstin': gstin.isEmpty ? null : gstin.toUpperCase(),
        'state': _state,
        'state_code': stateCode(_state),
        'opening_balance': 0,
        'opening_balance_type': 'credit',
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
      appBar: AppBar(title: const Text('New supplier')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Name *')),
          TextField(controller: _phone, decoration: const InputDecoration(labelText: 'Phone'), keyboardType: TextInputType.phone),
          TextField(controller: _email, decoration: const InputDecoration(labelText: 'Email')),
          TextField(controller: _gstin, decoration: const InputDecoration(labelText: 'GSTIN')),
          DropdownButtonFormField<String>(
            isExpanded: true,
            initialValue: _state,
            decoration: const InputDecoration(labelText: 'State'),
            items: [for (final s in indianStates) DropdownMenuItem(value: s, child: Text(s))],
            onChanged: (v) => setState(() => _state = v ?? 'Karnataka'),
          ),
          const SizedBox(height: 16),
          FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving...' : 'Save supplier')),
        ],
      ),
    );
  }
}
