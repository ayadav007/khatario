/// Number formatting that matches the website's `toLocaleString('en-IN', ...)`.
String _groupIndian(String digits) {
  if (digits.length <= 3) return digits;
  final tail = digits.substring(digits.length - 3);
  var head = digits.substring(0, digits.length - 3);
  final parts = <String>[];
  while (head.length > 2) {
    parts.insert(0, head.substring(head.length - 2));
    head = head.substring(0, head.length - 2);
  }
  if (head.isNotEmpty) parts.insert(0, head);
  return '${parts.join(',')},$tail';
}

/// Rupee sign as a code point so the source file cannot turn it into `â‚¹`.
const rupeeSign = '\u20B9';

/// `₹` plus Indian grouping. Whole rupees by default, matching the dashboard hero.
String inr(num value, {int maxFraction = 0}) => '$rupeeSign${enIn(value, maxFraction: maxFraction)}';

/// `value.toLocaleString('en-IN', { maximumFractionDigits })`. JS default is 3.
String enIn(num value, {int maxFraction = 3}) {
  final negative = value < 0;
  final fixed = value.abs().toStringAsFixed(maxFraction);
  final dot = fixed.indexOf('.');
  final whole = dot == -1 ? fixed : fixed.substring(0, dot);
  var fraction = dot == -1 ? '' : fixed.substring(dot + 1);
  fraction = fraction.replaceFirst(RegExp(r'0+$'), '');
  final grouped = _groupIndian(whole);
  final text = fraction.isEmpty ? grouped : '$grouped.$fraction';
  return negative && text != '0' ? '-$text' : text;
}

/// JavaScript `String(Number(x))`: `5` not `5.0`.
String jsNumberString(num n) => n == n.truncate() ? n.truncate().toString() : n.toString();

num toNum(dynamic value) {
  if (value is num) return value;
  if (value is String) return num.tryParse(value) ?? 0;
  return 0;
}

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/// date-fns `d MMM`.
String dMMM(DateTime d) => '${d.day} ${_months[d.month - 1]}';

/// date-fns `dd MMM`.
String ddMMM(DateTime d) => '${d.day.toString().padLeft(2, '0')} ${_months[d.month - 1]}';

/// date-fns `MMM dd`.
String mmmDD(DateTime d) => '${_months[d.month - 1]} ${d.day.toString().padLeft(2, '0')}';

/// date-fns `MMM-yy`.
String mmmYY(DateTime d) => '${_months[d.month - 1]}-${(d.year % 100).toString().padLeft(2, '0')}';

/// `dd/MM/yyyy`.
String ddMMyyyySlash(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';

/// date-fns `dd MMM yyyy`.
String ddMMMyyyy(DateTime d) => '${ddMMM(d)} ${d.year}';

/// date-fns `dd MMM yyyy, HH:mm`.
String ddMMMyyyyHm(DateTime d) =>
    '${ddMMMyyyy(d)}, ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

/// date-fns `yyyy-MM-dd`.
String ymd(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

DateTime dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);
