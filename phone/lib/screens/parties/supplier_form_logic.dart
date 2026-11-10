import '../../format.dart';
import 'customer_form_logic.dart';

/// Body builders and checks for the supplier form (`suppliers/new/page.tsx`,
/// `POST /api/suppliers`, `PUT /api/suppliers/[id]`). Identity (business, user, creator) is never
/// sent: the server takes it from the session.

String _s(dynamic v) => v?.toString().trim() ?? '';

final _panShape = RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$');

/// What is wrong with each field, null when it is fine.
class SupplierErrors {
  const SupplierErrors({this.name, this.phone, this.gstin, this.pan, this.pincode, this.state, this.amount});

  final String? name;
  final String? phone;
  final String? gstin;
  final String? pan;
  final String? pincode;
  final String? state;
  final String? amount;

  bool get ok => name == null && phone == null && gstin == null && pan == null && pincode == null && state == null && amount == null;
}

/// The website requires a name and checks the GSTIN with `isValidGstin`; the server also refuses a
/// malformed PAN and keeps phones of 8 to 15 digits (`normalizePhoneOrNull`).
SupplierErrors validateSupplier({
  required String name,
  required String phone,
  required String gstin,
  required String pan,
  required String pincode,
  String state = '',
  String openingBalance = '',
  Map<String, dynamic>? existing,
}) {
  final phoneDigits = phone.replaceAll(RegExp(r'\D'), '');
  final g = gstin.trim();
  final p = pan.trim().toUpperCase();
  final pin = pincode.trim();
  // The update route keeps the old value when a field is missing, so these cannot be blanked.
  String? locked(String key, String typed, String label) =>
      existing != null && typed.trim().isEmpty && _s(existing[key]).isNotEmpty ? "$label can't be removed once saved" : null;
  return SupplierErrors(
    name: name.trim().isEmpty ? 'Supplier name is required' : null,
    phone: locked('phone', phone, 'Phone') ??
        (phone.trim().isNotEmpty && (phoneDigits.length < 8 || phoneDigits.length > 15) ? 'Enter a valid phone number' : null),
    gstin: locked('gstin', gstin, 'GSTIN') ?? (g.isNotEmpty && !isValidGstin(g) ? 'Enter a valid GSTIN' : null),
    pan: locked('pan', pan, 'PAN') ?? (p.isNotEmpty && !_panShape.hasMatch(p) ? 'Enter a valid PAN, like ABCDE1234F' : null),
    pincode: pin.isNotEmpty && !RegExp(r'^[0-9]{6}$').hasMatch(pin) ? 'Pincode is 6 digits' : null,
    state: locked('state', state, 'State'),
    amount: openingBalance.trim().isNotEmpty && parseAmount(openingBalance) == null ? 'Enter a valid amount' : null,
  );
}

/// The typed opening balance: 0 when blank, null when it is not a number.
double? parseAmount(String text) {
  final t = text.trim();
  if (t.isEmpty) return 0;
  final v = double.tryParse(t);
  return v == null || v < 0 ? null : v;
}

/// The state name in [business] (`state`) when it is one of [indianStates], else ''.
String businessStateOf(Map<String, dynamic> business) {
  final raw = business['state']?.toString().trim().toLowerCase() ?? '';
  if (raw.isEmpty) return '';
  for (final s in indianStates) {
    if (s.toLowerCase() == raw) return s;
  }
  return '';
}

/// `POST /api/suppliers` body. Empty optionals are left out. Notes, payment terms and bank
/// details are not sent: neither supplier route accepts them.
Map<String, dynamic> supplierBody({
  required String name,
  required String phone,
  required String email,
  required String address,
  required String city,
  required String state,
  required String pincode,
  required String gstin,
  required String pan,
  required String openingBalance,
  required bool toPay,
}) {
  final amount = parseAmount(openingBalance) ?? 0;
  final st = state.trim();
  final code = st.isEmpty ? '' : stateCode(st);
  return {
    'name': name.trim(),
    if (phone.trim().isNotEmpty) 'phone': phone.trim(),
    if (email.trim().isNotEmpty) 'email': email.trim(),
    if (address.trim().isNotEmpty) 'address': address.trim(),
    if (city.trim().isNotEmpty) 'city': city.trim(),
    if (st.isNotEmpty) 'state': st,
    if (code.isNotEmpty) 'state_code': code,
    if (pincode.trim().isNotEmpty) 'pincode': pincode.trim(),
    if (gstin.trim().isNotEmpty) 'gstin': gstin.replaceAll(RegExp(r'\s+'), '').toUpperCase(),
    if (pan.trim().isNotEmpty) 'pan': pan.trim().toUpperCase(),
    if (amount > 0) 'opening_balance': amount,
    'opening_balance_type': toPay ? 'credit' : 'debit',
  };
}

/// `PUT /api/suppliers/[id]` body: only what differs from [existing]. The route treats a missing
/// key as "leave it" and cannot clear a name, phone, state, GSTIN or PAN, so those are sent only
/// when a new value is typed; address, city, pincode and email may be cleared.
Map<String, dynamic> supplierEditBody({
  required Map<String, dynamic> existing,
  required String name,
  required String phone,
  required String email,
  required String address,
  required String city,
  required String state,
  required String pincode,
  required String gstin,
  required String pan,
  required String openingBalance,
  required bool toPay,
  bool? lowStock,
}) {
  final body = <String, dynamic>{};
  void text(String key, String typed, {bool clearable = false, String Function(String)? shape}) {
    final next = shape == null ? typed.trim() : shape(typed.trim());
    final was = shape == null ? _s(existing[key]) : shape(_s(existing[key]));
    if (next == was) return;
    if (next.isEmpty && !clearable) return;
    body[key] = next;
  }

  String digits(String v) => v.replaceAll(RegExp(r'\D'), '');
  String upper(String v) => v.replaceAll(RegExp(r'\s+'), '').toUpperCase();

  text('name', name);
  if (digits(phone) != digits(_s(existing['phone'])) && phone.trim().isNotEmpty) body['phone'] = phone.trim();
  text('email', email, clearable: true);
  text('address', address, clearable: true);
  text('city', city, clearable: true);
  text('pincode', pincode, clearable: true);
  final st = state.trim();
  if (st.isNotEmpty && st != _s(existing['state'])) {
    body['state'] = st;
    final code = stateCode(st);
    if (code.isNotEmpty) body['state_code'] = code;
  }
  text('gstin', gstin, shape: upper);
  text('pan', pan, shape: upper);

  final amount = parseAmount(openingBalance) ?? 0;
  final wasAmount = toNum(existing['opening_balance']).toDouble();
  final wasType = _s(existing['opening_balance_type']) == 'debit' ? 'debit' : 'credit';
  final type = toPay ? 'credit' : 'debit';
  if ((amount - wasAmount).abs() >= 0.005 || type != wasType) {
    body['opening_balance'] = amount;
    body['opening_balance_type'] = type;
  }
  if (lowStock != null && lowStock != (existing['allow_low_stock_access'] == true)) body['allow_low_stock_access'] = lowStock;
  return body;
}
