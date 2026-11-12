import 'dart:math' as math;

import '../../format.dart';
import '../parties/customer_form_logic.dart' show isValidGstin;

/// Formulas for the Tools screens. Each one is the website's (`app/(app)/tools/<tool>/page.tsx`),
/// kept as pure functions so the screens only draw. These are user tools, not ledger figures.

/// `Number(x.toFixed(2))`: half-up on the exact value, like the website's `toFixed(2)`.
double round2(double value) {
  if (!value.isFinite) return 0;
  return double.parse(value.toStringAsFixed(2)) + 0.0;
}

/// `parseFloat(text) || 0`.
double parseAmount(String text) => double.tryParse(text.trim()) ?? 0;

/// `₹1,23,456.70`: always two decimals, Indian grouping. A negative reads `-₹12.30`.
String formatMoney(double value, {String symbol = rupeeSign}) {
  final fixed = value.abs().toStringAsFixed(2);
  final dot = fixed.indexOf('.');
  final whole = enIn(int.parse(fixed.substring(0, dot)), maxFraction: 0);
  final negative = value < 0 && fixed != '0.00';
  return '${negative ? '-' : ''}$symbol$whole${fixed.substring(dot)}';
}

/// An exchange rate with up to 6 decimals and no trailing zeros: `0.012048`, `83`.
String formatRate(double value) {
  var text = value.toStringAsFixed(6);
  if (text.contains('.')) text = text.replaceFirst(RegExp(r'\.?0+$'), '');
  return text;
}

/// `33.33%`.
String formatPercent(double value) => '${value.toStringAsFixed(2)}%';

// ---------------------------------------------------------------------------------------------
// EMI (emi-calculator/page.tsx): EMI = P x R x (1+R)^N / ((1+R)^N - 1), R = yearly % / 12 / 100.

double emi(double principal, double annualRatePct, int months) {
  if (principal <= 0 || months <= 0) return 0;
  final r = annualRatePct / 12 / 100;
  if (r <= 0) return principal / months;
  final growth = math.pow(1 + r, months).toDouble();
  return principal * r * growth / (growth - 1);
}

class EmiSummary {
  const EmiSummary(this.emi, this.totalAmount, this.totalInterest);

  final double emi;
  final double totalAmount;
  final double totalInterest;
}

EmiSummary emiSummary(double principal, double annualRatePct, int months) {
  final monthly = emi(principal, annualRatePct, months);
  final total = monthly * months;
  return EmiSummary(monthly, total, total - principal);
}

class EmiRow {
  const EmiRow(this.month, this.principal, this.interest, this.balance);

  final int month;
  final double principal;
  final double interest;
  final double balance;
}

/// The first 12 months (fewer for a shorter loan), as the website's table.
List<EmiRow> emiBreakdown(double principal, double annualRatePct, int months) {
  final monthly = emi(principal, annualRatePct, months);
  final r = annualRatePct / 12 / 100;
  final rows = <EmiRow>[];
  var balance = principal;
  for (var m = 1; m <= math.min(12, months); m++) {
    final interest = balance * r;
    final part = monthly - interest;
    balance -= part;
    rows.add(EmiRow(m, part, interest, math.max(0, balance)));
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Discount (discount-calculator/page.tsx)

class DiscountResult {
  const DiscountResult(this.discountAmount, this.finalPrice, this.savingsPercent);

  final double discountAmount;
  final double finalPrice;

  /// Discount as a share of the original price.
  final double savingsPercent;
}

DiscountResult discountResult(double price, double value, {required bool percent}) {
  final amount = percent ? price * value / 100 : value;
  return DiscountResult(amount, price - amount, price > 0 ? amount / price * 100 : 0);
}

// ---------------------------------------------------------------------------------------------
// Interest (interest-calculator/page.tsx): simple P x R x T / 100; compound P x (1 + R/100)^T.

class InterestResult {
  const InterestResult(this.interest, this.total);

  final double interest;
  final double total;
}

InterestResult interestResult(double principal, double ratePct, double years, {required bool compound}) {
  if (compound) {
    final total = principal * math.pow(1 + ratePct / 100, years).toDouble();
    return InterestResult(total - principal, total);
  }
  final interest = principal * ratePct * years / 100;
  return InterestResult(interest, principal + interest);
}

// ---------------------------------------------------------------------------------------------
// Price and margin (price-margin-calculator/page.tsx). Margin is profit over the selling price,
// markup is profit over the cost.

enum MarginMode { costToPrice, priceToCost, margin }

class MarginResult {
  const MarginResult({required this.cost, required this.selling, required this.profit, required this.margin, required this.markup});

  final double cost;
  final double selling;
  final double profit;
  final double margin;
  final double markup;
}

/// Null while the inputs are not enough to show anything. A margin of 100% or more has no price
/// (the website divides by zero there), so it shows nothing too.
MarginResult? priceMargin(MarginMode mode, {double cost = 0, double selling = 0, double marginPct = 0, double markupPct = 0}) {
  switch (mode) {
    case MarginMode.costToPrice:
      if (cost <= 0) return null;
      if (marginPct > 0) {
        if (marginPct >= 100) return null;
        final price = cost / (1 - marginPct / 100);
        final profit = price - cost;
        return MarginResult(cost: cost, selling: price, profit: profit, margin: marginPct, markup: profit / cost * 100);
      }
      if (markupPct > 0) {
        final price = cost * (1 + markupPct / 100);
        final profit = price - cost;
        return MarginResult(cost: cost, selling: price, profit: profit, margin: profit / price * 100, markup: markupPct);
      }
      return null;
    case MarginMode.priceToCost:
      if (selling <= 0) return null;
      if (marginPct > 0) {
        if (marginPct >= 100) return null;
        final c = selling * (1 - marginPct / 100);
        final profit = selling - c;
        return MarginResult(cost: c, selling: selling, profit: profit, margin: marginPct, markup: profit / c * 100);
      }
      if (markupPct > 0) {
        final c = selling / (1 + markupPct / 100);
        final profit = selling - c;
        return MarginResult(cost: c, selling: selling, profit: profit, margin: profit / selling * 100, markup: markupPct);
      }
      return null;
    case MarginMode.margin:
      if (cost <= 0 || selling <= 0) return null;
      final profit = selling - cost;
      return MarginResult(cost: cost, selling: selling, profit: profit, margin: profit / selling * 100, markup: profit / cost * 100);
  }
}

// ---------------------------------------------------------------------------------------------
// TDS (tds-calculator/page.tsx)

class TdsSection {
  const TdsSection(this.label, this.rate);

  final String label;
  final double rate;

  /// The website treats the 0% row as "Custom Rate".
  bool get isCustom => rate == 0;

  /// The option text: `194C - Contractors (2%)`.
  String get optionLabel => rate > 0 ? '$label (${jsNumberString(rate)}%)' : label;
}

const tdsSections = <TdsSection>[
  TdsSection('194A - Interest (Bank FD)', 10),
  TdsSection('194C - Contractors', 2),
  TdsSection('194D - Insurance Commission', 5),
  TdsSection('194H - Commission/Brokerage', 5),
  TdsSection('194I - Rent (Land/Building)', 10),
  TdsSection('194I - Rent (Plant/Machinery)', 2),
  TdsSection('194J - Professional Services', 10),
  TdsSection('194Q - Purchase of Goods', 0.1),
  TdsSection('194S - Crypto/Virtual Assets', 1),
  TdsSection('194TDS - E-commerce', 1),
  TdsSection('Custom Rate', 0),
];

/// Rates offered as quick chips when the section is "Custom Rate".
const tdsQuickRates = <double>[0.1, 1, 2, 5, 10, 15, 20, 30];

class TdsResult {
  const TdsResult(this.tds, this.net);

  final double tds;
  final double net;
}

TdsResult tdsResult(double amount, double ratePct) {
  final tds = amount * ratePct / 100;
  return TdsResult(tds, amount - tds);
}

// ---------------------------------------------------------------------------------------------
// Currency (currency-converter/page.tsx). The website has no live feed either: it uses the same
// approximate table. Its table holds rupees per unit; the website applies it the wrong way round
// for INR to another currency, so here the rate is always (rupees per `from`) / (rupees per `to`).

class CurrencyInfo {
  const CurrencyInfo(this.code, this.name, this.symbol);

  final String code;
  final String name;
  final String symbol;
}

const currencies = <CurrencyInfo>[
  CurrencyInfo('INR', 'Indian Rupee', '₹'),
  CurrencyInfo('USD', 'US Dollar', '\$'),
  CurrencyInfo('EUR', 'Euro', '€'),
  CurrencyInfo('GBP', 'British Pound', '£'),
  CurrencyInfo('AED', 'UAE Dirham', 'AED'),
  CurrencyInfo('SAR', 'Saudi Riyal', 'SAR'),
  CurrencyInfo('JPY', 'Japanese Yen', '¥'),
  CurrencyInfo('CNY', 'Chinese Yuan', '¥'),
  CurrencyInfo('AUD', 'Australian Dollar', 'A\$'),
  CurrencyInfo('CAD', 'Canadian Dollar', 'C\$'),
  CurrencyInfo('SGD', 'Singapore Dollar', 'S\$'),
  CurrencyInfo('CHF', 'Swiss Franc', 'CHF'),
];

const _rupeesPerUnit = <String, double>{
  'INR': 1,
  'USD': 83.0,
  'EUR': 90.0,
  'GBP': 105.0,
  'AED': 22.6,
  'SAR': 22.1,
  'JPY': 0.56,
  'CNY': 11.5,
  'AUD': 54.0,
  'CAD': 61.0,
  'SGD': 61.5,
  'CHF': 92.0,
};

/// How many `to` one `from` buys.
double exchangeRate(String from, String to) {
  if (from == to) return 1;
  return (_rupeesPerUnit[from] ?? 1) / (_rupeesPerUnit[to] ?? 1);
}

double convertCurrency(double amount, double rate) => amount * rate;

// ---------------------------------------------------------------------------------------------
// Invoice number generator (invoice-number-generator/page.tsx)

List<String> invoiceNumbers({
  required String prefix,
  required String suffix,
  required int start,
  required int padding,
  required int count,
  required String year,
  required String month,
  required bool includeYear,
  required bool includeMonth,
}) {
  final width = padding.clamp(1, 10);
  final total = count.clamp(1, 100);
  return [
    for (var i = 0; i < total; i++)
      '$prefix${includeYear ? year : ''}${includeMonth ? month : ''}${(start + i).toString().padLeft(width, '0')}$suffix',
  ];
}

// ---------------------------------------------------------------------------------------------
// GST calculator (gst-calculator/page.tsx)

class GstSplit {
  const GstSplit({required this.base, required this.gst, required this.total, required this.cgst, required this.sgst, required this.igst});

  final double base;
  final double gst;
  final double total;
  final double cgst;
  final double sgst;
  final double igst;
}

GstSplit gstSplit(double amount, double ratePct, {required bool inclusive}) {
  final double base;
  final double gst;
  final double total;
  if (inclusive) {
    total = amount;
    base = amount * 100 / (100 + ratePct);
    gst = total - base;
  } else {
    base = amount;
    gst = amount * ratePct / 100;
    total = amount + gst;
  }
  return GstSplit(base: base, gst: gst, total: total, cgst: gst / 2, sgst: gst / 2, igst: gst);
}

// ---------------------------------------------------------------------------------------------
// GSTIN and PAN checks (gstin-validator, pan-validator)

class IdCheck {
  const IdCheck({required this.valid, required this.title, required this.message, this.details = const []});

  final bool valid;
  final String title;
  final String message;
  final List<(String, String)> details;
}

const _gstStates = <String, String>{
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
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

final _gstinFormat = RegExp(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

/// The website checks length and format; this also checks the state code and the check
/// character (`isValidGstin`), so a mistyped GSTIN does not pass.
IdCheck checkGstin(String raw) {
  final gstin = raw.trim().toUpperCase();
  IdCheck bad(String why) => IdCheck(valid: false, title: 'Invalid GSTIN', message: why);
  if (gstin.isEmpty) return bad('Enter a GSTIN');
  if (gstin.length != 15) return bad('Wrong length: a GSTIN has exactly 15 characters');
  if (!_gstinFormat.hasMatch(gstin)) {
    return bad('Wrong format: 2 digits (state), 10 PAN characters, then 3 characters ending in a check character, like 27AADCB2230M1ZV');
  }
  final code = gstin.substring(0, 2);
  final state = _gstStates[code];
  if (state == null) return bad('The state code $code is not a GST state code');
  if (!isValidGstin(gstin)) return bad('The last character does not match the checksum, so one of the characters is mistyped');
  return IdCheck(
    valid: true,
    title: 'Valid GSTIN',
    message: 'Format and checksum are correct. This does not prove the number is registered.',
    details: [
      ('State', state),
      ('PAN', gstin.substring(2, 12)),
      ('Entity type', gstin[12] == '2' ? 'Composition Taxpayer' : 'Regular Taxpayer'),
    ],
  );
}

final _panFormat = RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$');

/// The 4th character of a PAN is the holder type.
const _panHolders = <String, String>{
  'P': 'Individual',
  'C': 'Company',
  'H': 'HUF (Hindu Undivided Family)',
  'F': 'Firm',
  'A': 'Association of Persons',
  'T': 'Trust',
  'B': 'Body of Individuals',
  'L': 'Local Authority',
  'J': 'Artificial Juridical Person',
  'G': 'Government',
};

/// The website checks the format and then reads the type from the wrong letters (the first
/// three and the fifth). The holder type is the 4th letter, so that is what is read here, and a
/// 4th letter outside the ten holder types is not a real PAN. Both labels the website shows,
/// "Type" and "Entity type", carry the holder description.
IdCheck checkPan(String raw) {
  final pan = raw.trim().toUpperCase();
  IdCheck bad(String why) => IdCheck(valid: false, title: 'Invalid PAN', message: why);
  if (pan.isEmpty) return bad('Enter a PAN');
  if (!_panFormat.hasMatch(pan)) return bad('Wrong format: 5 letters, 4 digits, then 1 letter, like ABCDE1234F');
  final holder = _panHolders[pan[3]];
  if (holder == null) return bad("The 4th character '${pan[3]}' is not a holder type. It must be one of P, C, H, F, A, T, B, L, J or G");
  return IdCheck(
    valid: true,
    title: 'Valid PAN',
    message: 'The format is correct. This does not prove the PAN is issued.',
    details: [('Type', holder), ('Entity type', holder)],
  );
}

// ---------------------------------------------------------------------------------------------
// HSN finder and lead extractor responses

class HsnHit {
  const HsnHit({required this.code, required this.description, required this.rate, required this.condition, required this.isService});

  final String code;
  final String description;
  final num? rate;
  final String condition;
  final bool isService;

  /// `5%`, or null when the route has no rate for the code (services, mostly).
  String? get rateLabel => rate == null ? null : '${jsNumberString(rate!)}%';
}

/// `GET /api/hsn/lookup` answers `{ results: [...] }`.
List<HsnHit> parseHsnResults(dynamic body) {
  final rows = body is Map ? body['results'] : null;
  if (rows is! List) return const [];
  return [
    for (final row in rows)
      if (row is Map)
        HsnHit(
          code: row['code']?.toString() ?? '',
          description: row['description']?.toString() ?? '',
          rate: row['gst_rate'] is num ? row['gst_rate'] as num : num.tryParse(row['gst_rate']?.toString() ?? ''),
          condition: row['rate_condition']?.toString() ?? '',
          isService: row['is_service'] == true,
        ),
  ];
}

class Lead {
  const Lead({required this.name, required this.phone, required this.address, required this.website, required this.rating, required this.reviews, required this.mapsUrl});

  final String name;
  final String phone;
  final String address;
  final String website;
  final double? rating;
  final int reviews;
  final String mapsUrl;
}

/// `POST /api/tools/google-leads/search` answers `{ leads: [...] }`.
List<Lead> parseLeads(dynamic body) {
  final rows = body is Map ? body['leads'] : null;
  if (rows is! List) return const [];
  String text(Map row, String key) => row[key]?.toString() ?? '';
  return [
    for (final row in rows)
      if (row is Map)
        Lead(
          name: text(row, 'business_name'),
          phone: text(row, 'phone'),
          address: text(row, 'address'),
          website: text(row, 'website'),
          rating: row['rating'] is num && (row['rating'] as num) > 0 ? (row['rating'] as num).toDouble() : null,
          reviews: row['reviews'] is num ? (row['reviews'] as num).toInt() : 0,
          mapsUrl: text(row, 'maps_url'),
        ),
  ];
}
