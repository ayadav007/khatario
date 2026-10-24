import '../../format.dart';
import 'party_logic.dart';

/// Dropdown values from `lib/gst-utils.ts` `INDIAN_STATES`.
const indianStates = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
  'Delhi',
];

const customerCountries = [
  'India',
  'United States',
  'United Kingdom',
  'United Arab Emirates',
  'Singapore',
  'Germany',
  'France',
  'Canada',
  'Australia',
  'Japan',
  'China',
  'Other',
];

const _stateCodes = {
  'andhra pradesh': '37',
  'arunachal pradesh': '12',
  'assam': '18',
  'bihar': '10',
  'chhattisgarh': '22',
  'goa': '30',
  'gujarat': '24',
  'haryana': '06',
  'himachal pradesh': '02',
  'jharkhand': '20',
  'karnataka': '29',
  'kerala': '32',
  'madhya pradesh': '23',
  'maharashtra': '27',
  'manipur': '14',
  'meghalaya': '17',
  'mizoram': '15',
  'nagaland': '13',
  'odisha': '21',
  'punjab': '03',
  'rajasthan': '08',
  'sikkim': '11',
  'tamil nadu': '33',
  'tamilnadu': '33',
  'telangana': '36',
  'tripura': '16',
  'uttar pradesh': '09',
  'uttarakhand': '05',
  'west bengal': '19',
  'andaman and nicobar islands': '35',
  'chandigarh': '04',
  'dadra and nagar haveli and daman and diu': '26',
  'daman and diu': '26',
  'dadra and nagar haveli': '26',
  'jammu and kashmir': '01',
  'ladakh': '38',
  'lakshadweep': '31',
  'puducherry': '34',
  'pondicherry': '34',
  'delhi': '07',
  'nct of delhi': '07',
};

/// `getStateCode` in `lib/gst-utils.ts`.
String stateCode(String stateName) => _stateCodes[stateName.trim().toLowerCase()] ?? '';

const _gstStateNames = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

/// State name used when GSTIN lookup returns only a state code.
String gstStateName(String code) => _gstStateNames[code] ?? '';

const _gstinCharset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
final _gstinShape = RegExp(r'^[0-9]{2}[A-Z0-9]{10}[0-9A-Z][A-Z0-9][0-9A-Z]$');

/// `isValidGstin` in `lib/tax/gstin.ts`.
bool isValidGstin(String value) {
  final gstin = value.replaceAll(RegExp(r'\s+'), '').toUpperCase();
  if (gstin.length != 15 || !_gstinShape.hasMatch(gstin)) return false;
  if (!_gstStateNames.containsKey(gstin.substring(0, 2)) && gstin.substring(0, 2) != '25' && gstin.substring(0, 2) != '28' && gstin.substring(0, 2) != '97' && gstin.substring(0, 2) != '99') {
    return false;
  }
  return _gstinCheckChar(gstin.substring(0, 14)) == gstin[14];
}

String? _gstinCheckChar(String first14) {
  if (first14.length != 14) return null;
  var sum = 0;
  for (var i = 0; i < 14; i++) {
    final v = _gstinCharset.indexOf(first14[i]);
    if (v < 0) return null;
    final product = v * (i.isEven ? 1 : 2);
    sum += product ~/ 36 + (product % 36);
  }
  return _gstinCharset[(36 - (sum % 36)) % 36];
}

/// Shipping block on the new and edit customer forms.
String buildShippingAddress(String billing, String city, String state, String pincode) {
  final lines = <String>[];
  if (billing.isNotEmpty) lines.add(billing);
  final parts = [city, state, pincode].where((p) => p.isNotEmpty).toList();
  if (parts.length == 3) {
    lines.add('${parts[0]}, ${parts[1]} - ${parts[2]}');
  } else if (parts.isNotEmpty) {
    lines.add(parts.join(', '));
  }
  return lines.join('\n');
}

String? _blank(String value) => value.trim().isEmpty ? null : value.trim();

int? _creditDays(String value) {
  if (value.trim().isEmpty) return null;
  final n = int.tryParse(value.trim()) ?? 0;
  return n < 0 ? 0 : n;
}

/// POST `/api/customers` body. The session user is the actor; `created_by` is not sent.
Map<String, dynamic> customerCreateBody({
  required String name,
  required String companyName,
  required String phone,
  required String email,
  required String gstin,
  required String billingAddress,
  required String shippingAddress,
  required String city,
  required String state,
  required String pincode,
  required String country,
  required String openingBalance,
  required String openingBalanceType,
  required String creditLimit,
  required String creditDays,
}) {
  final code = stateCode(state);
  final days = _creditDays(creditDays);
  return {
    'name': name,
    'company_name': _blank(companyName),
    'phone': _blank(phone),
    'email': _blank(email),
    'address': null,
    'billing_address': _blank(billingAddress),
    'shipping_address': _blank(shippingAddress),
    'city': _blank(city),
    'state': _blank(state),
    'state_code': code.isEmpty ? null : code,
    'pincode': _blank(pincode),
    'country': country.isEmpty ? 'India' : country,
    'gstin': _blank(gstin),
    'opening_balance': num.tryParse(openingBalance) ?? 0,
    'opening_balance_type': openingBalanceType.isEmpty ? 'debit' : openingBalanceType,
    'credit_limit': num.tryParse(creditLimit) ?? 0,
    'credit_days': ?days,
  };
}

/// PUT `/api/customers/:id` body. `user_id` is not sent.
Map<String, dynamic> customerUpdateBody({
  required String name,
  required String phone,
  required String email,
  required String gstin,
  required String billingAddress,
  required String shippingAddress,
  required String city,
  required String state,
  required String pincode,
  required String country,
  required String openingBalance,
  required String openingBalanceType,
  required String creditLimit,
  required String creditDays,
}) {
  return {
    'name': name,
    'phone': phone,
    'email': email,
    'gstin': gstin,
    'address': '',
    'billing_address': billingAddress,
    'shipping_address': shippingAddress,
    'city': city,
    'state': state,
    'pincode': pincode,
    'country': country.isEmpty ? 'India' : country,
    'opening_balance': num.tryParse(openingBalance) ?? 0,
    'opening_balance_type': openingBalanceType.isEmpty ? 'debit' : openingBalanceType,
    'credit_limit': num.tryParse(creditLimit) ?? 0,
    'credit_days': _creditDays(creditDays),
  };
}

/// `dd/MM/yyyy` for statement dates. Date-only strings stay on that calendar day.
String statementDate(dynamic value) {
  final d = parsePartyDate(value);
  if (d == null) return value?.toString() ?? '';
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

String csvEscape(dynamic value) {
  final s = value == null ? '' : value.toString();
  if (RegExp(r'[",\r\n]').hasMatch(s)) return '"${s.replaceAll('"', '""')}"';
  return s;
}

/// `buildStatementCsv` on the customer statement page.
String buildStatementCsv({
  required String businessName,
  required String partyName,
  required String fromDate,
  required String toDate,
  required num openingBalance,
  required num closingBalance,
  required List<Map<String, dynamic>> transactions,
}) {
  final lines = <String>[
    [csvEscape('Business'), csvEscape(businessName)].join(','),
    [csvEscape('Customer'), csvEscape(partyName)].join(','),
    [csvEscape('Period'), csvEscape('$fromDate to $toDate')].join(','),
    [csvEscape('Opening balance'), csvEscape(openingBalance)].join(','),
    [csvEscape('Closing balance'), csvEscape(closingBalance)].join(','),
    '',
    ['Date', 'Voucher', 'Reference', 'Particulars', 'Debit', 'Credit', 'Balance'].map(csvEscape).join(','),
    for (final t in transactions)
      [
        csvEscape(statementDate(t['transaction_date'])),
        csvEscape(customerVoucherLabel(t['transaction_type']?.toString() ?? '')),
        csvEscape(t['reference_number']),
        csvEscape(t['description']),
        csvEscape(t['debit'] ?? ''),
        csvEscape(t['credit'] ?? ''),
        csvEscape(t['running_balance'] ?? ''),
      ].join(','),
  ];
  return '\uFEFF${lines.join('\r\n')}';
}

/// Indian financial year start through today, `yyyy-MM-dd`.
({String fromDate, String toDate}) defaultStatementPeriod(DateTime today) {
  final to = DateTime(today.year, today.month, today.day);
  return (fromDate: ymd(indianFinancialYearStart(today)), toDate: ymd(to));
}
