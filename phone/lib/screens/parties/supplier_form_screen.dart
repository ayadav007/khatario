import 'package:flutter/material.dart';

import '../../api.dart';
import '../../format.dart';
import '../../session.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'customer_form_logic.dart';
import 'supplier_form_logic.dart';

/// New and edit supplier forms from `suppliers/new/page.tsx`. Identity stays in the session.
///
/// Notes, payment terms and bank details are not on the website form and neither supplier route
/// accepts them, so the phone does not show them either.
class SupplierFormScreen extends StatefulWidget {
  const SupplierFormScreen({super.key, required this.session, this.supplier});

  final AppSession session;

  /// The supplier to edit (as loaded from `GET /api/suppliers/[id]`). Null creates one.
  final Map<String, dynamic>? supplier;

  bool get editing => supplier != null;

  @override
  State<SupplierFormScreen> createState() => _SupplierFormScreenState();
}

class _SupplierFormScreenState extends State<SupplierFormScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _address = TextEditingController();
  final _city = TextEditingController();
  final _pincode = TextEditingController();
  final _gstin = TextEditingController();
  final _pan = TextEditingController();
  final _opening = TextEditingController();

  String _state = '';
  bool _toPay = true;
  bool _dirty = false;
  String _panAuto = '';
  String _openingOriginal = '';
  bool _lowStock = false;
  bool _lookingUp = false;
  SupplierErrors _errors = const SupplierErrors();

  bool get _linked => (_existing['linked_business_id']?.toString() ?? '').isNotEmpty;

  Map<String, dynamic> get _existing => widget.supplier ?? const {};

  @override
  void initState() {
    super.initState();
    if (widget.editing) {
      final s = _existing;
      String t(String k) => s[k]?.toString().trim() ?? '';
      _name.text = t('name');
      _phone.text = t('phone');
      _email.text = t('email');
      _address.text = t('address');
      _city.text = t('city');
      _pincode.text = t('pincode');
      _gstin.text = t('gstin');
      _pan.text = t('pan');
      _state = t('state');
      final amount = toNum(s['opening_balance']).toDouble();
      _opening.text = amount > 0 ? (amount == amount.roundToDouble() ? amount.toInt().toString() : amount.toString()) : '';
      _toPay = t('opening_balance_type') != 'debit';
      _lowStock = s['allow_low_stock_access'] == true;
    } else {
      _state = businessStateOf(widget.session.business);
      if (_state.isEmpty) _loadBusinessState();
    }
    _openingOriginal = _opening.text;
    _opening.addListener(() {
      if (_opening.text != _openingOriginal) _touch();
    });
  }

  @override
  void dispose() {
    for (final c in [_name, _phone, _email, _address, _city, _pincode, _gstin, _pan, _opening]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The session does not carry the business's state, so read it once from the business record.
  Future<void> _loadBusinessState() async {
    final id = widget.session.businessId;
    if (id == null) return;
    try {
      final body = await widget.session.api.getJson('/api/businesses/$id');
      final raw = body['business'];
      final found = raw is Map ? businessStateOf(Map<String, dynamic>.from(raw)) : '';
      if (mounted && found.isNotEmpty && _state.isEmpty) setState(() => _state = found);
    } catch (_) {
      // No preselected state.
    }
  }

  void _touch() {
    if (!_dirty) setState(() => _dirty = true);
  }

  /// A valid GSTIN carries the state (first two digits) and the PAN (characters 3 to 12).
  void _gstinChanged(String value) {
    final g = value.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    setState(() {
      _dirty = true;
      if (g.length == 15 && isValidGstin(g)) {
        final name = gstStateName(g.substring(0, 2));
        if (name.isNotEmpty) _state = name;
        final pan = g.substring(2, 12);
        if (_pan.text.trim().isEmpty || _pan.text.trim().toUpperCase() == _panAuto) {
          _pan.text = pan;
          _panAuto = pan;
        }
      }
    });
  }

  /// Same lookup as the customer form (`GET /api/gstin/lookup`). Tapping the button fills the
  /// name, address, city, state, pincode and PAN from the reply.
  Future<void> _lookup() async {
    final g = _gstin.text.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    if (!isValidGstin(g)) {
      setState(() => _errors = SupplierErrors(gstin: 'Enter a valid GSTIN'));
      return;
    }
    setState(() => _lookingUp = true);
    try {
      final data = await widget.session.api.getJson('/api/gstin/lookup?gstin=$g');
      if (!mounted) return;
      String v(String k) => data[k]?.toString().trim() ?? '';
      final found = data['api_configured'] != false && v('legal_name').isNotEmpty;
      setState(() {
        _dirty = true;
        _errors = const SupplierErrors();
        if (found) {
          _name.text = v('legal_name');
          if (v('address').isNotEmpty) _address.text = v('address');
          if (v('city').isNotEmpty) _city.text = v('city');
          if (v('state').isNotEmpty) _state = v('state');
          if (v('pincode').isNotEmpty) _pincode.text = v('pincode');
        } else {
          final name = gstStateName(v('state_code'));
          if (name.isNotEmpty) _state = name;
        }
        _pan.text = g.substring(2, 12);
        _panAuto = _pan.text;
      });
      showKToast(context, found ? 'Details filled from the GSTIN' : 'GSTIN is valid. Details are not available right now.');
    } catch (_) {
      if (mounted) showKToast(context, 'Could not look up this GSTIN. Try again.', tone: KTone.negative);
    } finally {
      if (mounted) setState(() => _lookingUp = false);
    }
  }

  Future<void> _save() async {
    final errors = validateSupplier(
      name: _name.text,
      phone: _phone.text,
      gstin: _gstin.text,
      pan: _pan.text,
      pincode: _pincode.text,
      state: _state,
      openingBalance: _opening.text,
      existing: widget.editing ? _existing : null,
    );
    setState(() => _errors = errors);
    if (!errors.ok) return;
    final api = widget.session.api;
    if (widget.editing) {
      final body = supplierEditBody(
        existing: _existing,
        name: _name.text,
        phone: _phone.text,
        email: _email.text,
        address: _address.text,
        city: _city.text,
        state: _state,
        pincode: _pincode.text,
        gstin: _gstin.text,
        pan: _pan.text,
        openingBalance: _opening.text,
        toPay: _toPay,
        lowStock: _linked ? _lowStock : null,
      );
      if (body.isEmpty) {
        // Nothing changed: no request, nothing to reload.
        if (mounted) Navigator.of(context).pop(false);
        return;
      }
      await api.putJson('/api/suppliers/${_existing['id']}', body);
    } else {
      final data = await api.postJson(
        '/api/suppliers',
        supplierBody(
          name: _name.text,
          phone: _phone.text,
          email: _email.text,
          address: _address.text,
          city: _city.text,
          state: _state,
          pincode: _pincode.text,
          gstin: _gstin.text,
          pan: _pan.text,
          openingBalance: _opening.text,
          toPay: _toPay,
        ),
      );
      if (data['deduplicated'] == true) {
        throw ApiException('A supplier with this GSTIN already exists.');
      }
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return KFormScaffold(
      title: widget.editing ? 'Edit supplier' : 'Add new supplier',
      saveLabel: widget.editing ? 'Save changes' : 'Save supplier',
      onSave: _save,
      dirty: _dirty,
      children: [
        KFormSection(title: 'Basic details', children: [
          KTextField(label: 'Supplier name *', controller: _name, hint: 'Enter supplier name', error: _errors.name, onChanged: (_) => _touch()),
          KTextField(
            label: 'Phone',
            controller: _phone,
            hint: 'Mobile number',
            keyboard: TextInputType.phone,
            error: _errors.phone,
            onChanged: (_) => _touch(),
          ),
          KTextField(label: 'Email', controller: _email, hint: 'Email address', keyboard: TextInputType.emailAddress, onChanged: (_) => _touch()),
        ]),
        KFormSection(title: 'Address', children: [
          KTextField(label: 'Address', controller: _address, hint: 'Street address', maxLines: 2, onChanged: (_) => _touch()),
          KTextField(label: 'City', controller: _city, hint: 'City', onChanged: (_) => _touch()),
          KPickField<String>(
            label: 'State',
            value: _state.isEmpty ? null : _state,
            options: [for (final s in indianStates) (s, s)],
            searchable: true,
            onChanged: (v) => setState(() {
              _state = v;
              _dirty = true;
            }),
          ),
          KTextField(
            label: 'Pincode',
            controller: _pincode,
            hint: 'Pincode',
            keyboard: TextInputType.number,
            error: _errors.pincode,
            onChanged: (_) => _touch(),
          ),
        ]),
        KFormSection(title: 'GST & balance', children: [
          KTextField(
            label: 'GSTIN',
            controller: _gstin,
            hint: '29ABCDE1234F1Z5',
            caps: true,
            error: _errors.gstin,
            onChanged: _gstinChanged,
          ),
          KButton.secondary(
            label: _lookingUp ? 'Fetching...' : 'Fetch GSTIN details',
            onPressed: _lookingUp ? null : _lookup,
          ),
          KTextField(label: 'PAN', controller: _pan, hint: 'ABCDE1234F', caps: true, error: _errors.pan, onChanged: (_) => _touch()),
          KAmountField(label: 'Opening balance', controller: _opening, error: _errors.amount),
          KSegmented<bool>(
            value: _toPay,
            options: const [(true, 'To pay'), (false, 'To receive')],
            onChanged: (v) => setState(() {
              _toPay = v;
              _dirty = true;
            }),
          ),
        ]),
        if (_linked)
          KFormSection(title: 'Business linking', children: [
            KToggleField(
              label: 'Allow supplier to see low stock',
              help: 'They can view your low stock alerts from their supplier dashboard.',
              value: _lowStock,
              onChanged: (v) => setState(() {
                _lowStock = v;
                _dirty = true;
              }),
            ),
          ]),
      ],
    );
  }
}
