import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../format.dart';
import '../../theme.dart';
import '../../ui/form_kit.dart';
import '../../ui/kit.dart';
import '../../ui/toast.dart';
import 'calculator_logic.dart';
import 'tool_kit.dart';

/// The calculators and checkers of the Tools menu. Each has its own labelled fields and shows the
/// answer as the fields are filled; the formulas are in `calculator_logic.dart`.

// ---------------------------------------------------------------------------------------------

class EmiCalculatorScreen extends StatefulWidget {
  const EmiCalculatorScreen({super.key});

  @override
  State<EmiCalculatorScreen> createState() => _EmiCalculatorScreenState();
}

class _EmiCalculatorScreenState extends CalcState<EmiCalculatorScreen> {
  late final _loan = field();
  late final _rate = field();
  late final _tenure = field('12');
  bool _years = false;

  @override
  Widget build(BuildContext context) {
    final principal = parseAmount(_loan.text);
    final rate = parseAmount(_rate.text);
    final tenure = int.tryParse(_tenure.text.trim()) ?? 0;
    final maxTenure = _years ? 25 : 300;
    final tenureBad = _tenure.text.trim().isNotEmpty && (tenure < 1 || tenure > maxTenure);
    final rateBad = rate > 100;
    final ready = principal > 0 && rate > 0 && !rateBad && tenure >= 1 && tenure <= maxTenure;
    final months = _years ? tenure * 12 : tenure;
    final summary = ready ? emiSummary(principal, rate, months) : null;
    final rows = ready ? emiBreakdown(principal, rate, months) : const <EmiRow>[];
    return ToolScaffold(
      title: 'EMI Calculator',
      children: [
        KAmountField(label: 'Loan amount', controller: _loan),
        KNumberField(label: 'Annual interest rate (%)', controller: _rate, hint: '12', error: rateBad ? 'Enter 100 or less' : null),
        KSegmented<bool>(
          value: _years,
          options: const [(false, 'Months'), (true, 'Years')],
          onChanged: (v) => setState(() {
            _years = v;
            final now = int.tryParse(_tenure.text.trim()) ?? 0;
            final cap = v ? 25 : 300;
            if (now > cap) _tenure.text = '$cap';
          }),
        ),
        KTextField(
          label: _years ? 'Loan tenure (years)' : 'Loan tenure (months)',
          controller: _tenure,
          keyboard: TextInputType.number,
          error: tenureBad ? 'Enter 1 to $maxTenure' : null,
        ),
        if (summary == null)
          const ToolHint('Enter the loan amount and the yearly interest rate to see the monthly instalment.')
        else ...[
          ToolResult(
            label: 'Monthly EMI',
            value: formatMoney(summary.emi),
            rows: [
              ('Principal amount', formatMoney(principal)),
              ('Total interest', formatMoney(summary.totalInterest)),
              ('Total amount', formatMoney(summary.totalAmount)),
            ],
            note: 'EMI = P x R x (1+R)^N / ((1+R)^N - 1), with R the monthly rate and N the months.',
          ),
          _EmiTable(rows: rows),
        ],
      ],
    );
  }
}

class _EmiTable extends StatelessWidget {
  const _EmiTable({required this.rows});

  final List<EmiRow> rows;

  @override
  Widget build(BuildContext context) {
    Widget cell(String text, {bool head = false, bool first = false}) => Expanded(
          flex: first ? 2 : 4,
          child: Text(
            text,
            textAlign: first ? TextAlign.left : TextAlign.right,
            style: (head ? AppText.caption : AppText.small.copyWith(color: AppColors.ink, fontWeight: FontWeight.w500)).copyWith(fontFeatures: AppText.tabular),
          ),
        );
    String n(double v) => enIn(round2(v), maxFraction: 2);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSectionHeader('Payment breakdown (first ${rows.length} ${rows.length == 1 ? 'month' : 'months'})'),
        KCard(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.md, vertical: AppSpace.sm),
          child: Column(children: [
            Row(children: [cell('Month', head: true, first: true), cell('Principal', head: true), cell('Interest', head: true), cell('Balance', head: true)]),
            const Divider(height: 12, color: AppColors.hairline),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: Row(children: [cell('${r.month}', first: true), cell(n(r.principal)), cell(n(r.interest)), cell(n(r.balance))]),
              ),
          ]),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class DiscountCalculatorScreen extends StatefulWidget {
  const DiscountCalculatorScreen({super.key});

  @override
  State<DiscountCalculatorScreen> createState() => _DiscountCalculatorScreenState();
}

class _DiscountCalculatorScreenState extends CalcState<DiscountCalculatorScreen> {
  late final _price = field();
  late final _value = field();
  bool _percent = true;

  static const _presets = [5, 10, 15, 20, 25, 30, 40, 50];

  @override
  Widget build(BuildContext context) {
    final price = parseAmount(_price.text);
    final value = parseAmount(_value.text);
    final tooMuch = price > 0 && (_percent ? value > 100 : value > price);
    final ready = price > 0 && _value.text.trim().isNotEmpty && !tooMuch;
    final result = ready ? discountResult(price, value, percent: _percent) : null;
    const tooMuchText = 'Discount cannot be more than the price';
    return ToolScaffold(
      title: 'Discount Calculator',
      children: [
        KAmountField(label: 'Original price', controller: _price),
        KSegmented<bool>(
          value: _percent,
          options: const [(true, 'Percentage (%)'), (false, 'Fixed amount (₹)')],
          onChanged: (v) => setState(() => _percent = v),
        ),
        if (_percent)
          KNumberField(label: 'Discount percentage', controller: _value, hint: '0', error: tooMuch ? tooMuchText : null)
        else
          KAmountField(label: 'Discount amount', controller: _value, error: tooMuch ? tooMuchText : null),
        if (price > 0)
          KChipBar<String>(
            value: _percent && _presets.any((p) => '$p' == _value.text) ? _value.text : null,
            padding: EdgeInsets.zero,
            options: [for (final p in _presets) ('$p', '$p%')],
            onChanged: (v) => setState(() {
              _percent = true;
              _value.text = v;
            }),
          ),
        if (result == null)
          const ToolHint('Enter the price and the discount to see the final price.')
        else
          ToolResult(
            label: 'Final price',
            value: formatMoney(result.finalPrice),
            tone: KTone.positive,
            rows: [
              ('Original price', formatMoney(price)),
              ('Discount amount', formatMoney(result.discountAmount)),
              (_percent ? 'You save' : 'Discount', _percent ? '${formatMoney(result.discountAmount)} (${jsNumberString(value)}% off)' : '${formatPercent(result.savingsPercent)} off'),
            ],
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class InterestCalculatorScreen extends StatefulWidget {
  const InterestCalculatorScreen({super.key});

  @override
  State<InterestCalculatorScreen> createState() => _InterestCalculatorScreenState();
}

class _InterestCalculatorScreenState extends CalcState<InterestCalculatorScreen> {
  late final _principal = field();
  late final _rate = field();
  late final _years = field('1');
  bool _compound = false;

  @override
  Widget build(BuildContext context) {
    final principal = parseAmount(_principal.text);
    final rate = parseAmount(_rate.text);
    final years = parseAmount(_years.text);
    final yearsBad = _years.text.trim().isNotEmpty && (years < 0.1 || years > 30);
    final rateBad = rate > 100;
    final ready = principal > 0 && rate > 0 && !rateBad && years >= 0.1 && years <= 30;
    final result = ready ? interestResult(principal, rate, years, compound: _compound) : null;
    return ToolScaffold(
      title: 'Interest Calculator',
      children: [
        KAmountField(label: 'Principal amount', controller: _principal),
        KNumberField(label: 'Annual interest rate (%)', controller: _rate, hint: '12', error: rateBad ? 'Enter 100 or less' : null),
        KSegmented<bool>(
          value: _compound,
          options: const [(false, 'Simple interest'), (true, 'Compound interest')],
          onChanged: (v) => setState(() => _compound = v),
        ),
        KNumberField(label: 'Time (years)', controller: _years, hint: '1', error: yearsBad ? 'Enter 0.1 to 30 years' : null),
        if (result == null)
          const ToolHint('Enter the principal, the yearly rate and the years to see the interest.')
        else
          ToolResult(
            label: 'Total amount (principal + interest)',
            value: formatMoney(result.total),
            tone: KTone.positive,
            rows: [
              ('Principal amount', formatMoney(principal)),
              ('Interest amount', formatMoney(result.interest)),
              ('Period', '${jsNumberString(years)} ${years == 1 ? 'year' : 'years'}'),
            ],
            note: _compound ? 'Compound interest is worked out with yearly compounding.' : 'Simple interest is charged on the principal only.',
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class PriceMarginCalculatorScreen extends StatefulWidget {
  const PriceMarginCalculatorScreen({super.key});

  @override
  State<PriceMarginCalculatorScreen> createState() => _PriceMarginCalculatorScreenState();
}

class _PriceMarginCalculatorScreenState extends CalcState<PriceMarginCalculatorScreen> {
  late final _cost = field();
  late final _selling = field();
  late final _margin = field();
  late final _markup = field();
  MarginMode _mode = MarginMode.costToPrice;

  static const _presets = [10, 15, 20, 25, 30, 35, 40, 50, 60, 75];

  void _setMode(MarginMode mode) {
    setState(() {
      _mode = mode;
      _margin.clear();
      _markup.clear();
      if (mode == MarginMode.costToPrice) _selling.clear();
      if (mode == MarginMode.priceToCost) _cost.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final cost = parseAmount(_cost.text);
    final selling = parseAmount(_selling.text);
    final marginPct = parseAmount(_margin.text);
    final markupPct = parseAmount(_markup.text);
    final result = priceMargin(_mode, cost: cost, selling: selling, marginPct: marginPct, markupPct: markupPct);
    final base = _mode == MarginMode.costToPrice ? cost : selling;
    final tooHigh = _mode != MarginMode.margin && marginPct >= 100;
    final (headLabel, headValue) = switch (_mode) {
      MarginMode.costToPrice => ('Selling price', result?.selling),
      MarginMode.priceToCost => ('Cost price', result?.cost),
      MarginMode.margin => ('Profit', result?.profit),
    };
    return ToolScaffold(
      title: 'Price & Margin Calculator',
      children: [
        KSegmented<MarginMode>(
          value: _mode,
          options: const [(MarginMode.costToPrice, 'Cost → Price'), (MarginMode.priceToCost, 'Price → Cost'), (MarginMode.margin, 'Find margin')],
          onChanged: _setMode,
        ),
        if (_mode != MarginMode.priceToCost) KAmountField(label: 'Cost price', controller: _cost),
        if (_mode != MarginMode.costToPrice) KAmountField(label: 'Selling price', controller: _selling),
        if (_mode != MarginMode.margin) ...[
          KNumberField(
            label: 'Margin (%) on selling price',
            controller: _margin,
            hint: '0',
            error: tooHigh ? 'Enter less than 100' : null,
            onChanged: (v) {
              if (v.isNotEmpty) _markup.clear();
            },
          ),
          KNumberField(
            label: 'Markup (%) on cost price',
            controller: _markup,
            hint: '0',
            onChanged: (v) {
              if (v.isNotEmpty) _margin.clear();
            },
          ),
          if (base > 0)
            KChipBar<String>(
              value: _presets.any((p) => '$p' == _margin.text) ? _margin.text : null,
              padding: EdgeInsets.zero,
              options: [for (final p in _presets) ('$p', '$p%')],
              onChanged: (v) => setState(() {
                _margin.text = v;
                _markup.clear();
              }),
            ),
        ],
        if (result == null || headValue == null)
          ToolHint(_mode == MarginMode.margin ? 'Enter the cost and the selling price to see the margin and markup.' : 'Enter the price and a margin or a markup to see the result.')
        else
          ToolResult(
            label: headLabel,
            value: formatMoney(headValue),
            tone: _mode == MarginMode.margin && headValue < 0 ? KTone.negative : KTone.positive,
            rows: [
              ('Cost price', formatMoney(result.cost)),
              ('Selling price', formatMoney(result.selling)),
              ('Profit', formatMoney(result.profit)),
              ('Margin (profit / selling price)', formatPercent(result.margin)),
              ('Markup (profit / cost price)', formatPercent(result.markup)),
            ],
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class TdsCalculatorScreen extends StatefulWidget {
  const TdsCalculatorScreen({super.key});

  @override
  State<TdsCalculatorScreen> createState() => _TdsCalculatorScreenState();
}

class _TdsCalculatorScreenState extends CalcState<TdsCalculatorScreen> {
  late final _amount = field();
  late final _custom = field();
  int _section = 0;

  @override
  Widget build(BuildContext context) {
    final section = tdsSections[_section];
    final amount = parseAmount(_amount.text);
    final rate = section.isCustom ? parseAmount(_custom.text) : section.rate;
    final rateBad = rate > 100;
    final result = amount > 0 && rate > 0 && !rateBad ? tdsResult(amount, rate) : null;
    return ToolScaffold(
      title: 'TDS Calculator',
      children: [
        KAmountField(label: 'Payment amount', controller: _amount),
        KPickField<int>(
          label: 'TDS section and rate',
          value: _section,
          searchable: true,
          options: [for (final (i, s) in tdsSections.indexed) (i, s.optionLabel)],
          onChanged: (v) => setState(() {
            _section = v;
            _custom.clear();
          }),
        ),
        if (section.isCustom) ...[
          KNumberField(label: 'Custom TDS rate (%)', controller: _custom, hint: '0', error: rateBad ? 'Enter 100 or less' : null),
          KChipBar<String>(
            value: tdsQuickRates.any((r) => jsNumberString(r) == _custom.text) ? _custom.text : null,
            padding: EdgeInsets.zero,
            options: [for (final r in tdsQuickRates) (jsNumberString(r), '${jsNumberString(r)}%')],
            onChanged: (v) => setState(() => _custom.text = v),
          ),
        ],
        if (result == null)
          const ToolHint('Enter the payment and pick the section to see the TDS.')
        else
          ToolResult(
            label: 'Net amount payable',
            value: formatMoney(result.net),
            tone: KTone.positive,
            rows: [
              ('Gross payment', formatMoney(amount)),
              ('TDS deducted', formatMoney(result.tds)),
              ('TDS rate applied', section.isCustom ? '${jsNumberString(rate)}%' : '${jsNumberString(rate)}% (${section.label})'),
            ],
            note: 'Net = ${formatMoney(amount)} - ${formatMoney(result.tds)} (TDS @ ${jsNumberString(rate)}%). Rates change with PAN and thresholds, so check with your CA.',
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class CurrencyConverterScreen extends StatefulWidget {
  const CurrencyConverterScreen({super.key});

  @override
  State<CurrencyConverterScreen> createState() => _CurrencyConverterScreenState();
}

class _CurrencyConverterScreenState extends CalcState<CurrencyConverterScreen> {
  late final _amount = field();
  late final _ownRate = field();
  String _from = 'INR';
  String _to = 'USD';

  CurrencyInfo _info(String code) => currencies.firstWhere((c) => c.code == code);

  @override
  Widget build(BuildContext context) {
    final amount = parseAmount(_amount.text);
    final table = exchangeRate(_from, _to);
    final own = parseAmount(_ownRate.text);
    final rate = own > 0 ? own : table;
    final options = [for (final c in currencies) (c.code, '${c.code} - ${c.name}')];
    return ToolScaffold(
      title: 'Currency Converter',
      children: [
        KAmountField(label: 'Amount', controller: _amount),
        KPickField<String>(label: 'From', value: _from, options: options, searchable: true, onChanged: (v) => setState(() => _from = v)),
        Align(
          alignment: Alignment.center,
          child: KIconButton(
            icon: LucideIcons.arrowLeftRight,
            tooltip: 'Swap currencies',
            onTap: () => setState(() {
              final was = _from;
              _from = _to;
              _to = was;
            }),
          ),
        ),
        KPickField<String>(label: 'To', value: _to, options: options, searchable: true, onChanged: (v) => setState(() => _to = v)),
        KNumberField(label: 'Your rate (optional)', controller: _ownRate, hint: '1 $_from = ${formatRate(table)} $_to'),
        if (amount <= 0)
          const ToolHint('Enter an amount to convert. The built-in rates are approximate, not live.')
        else
          ToolResult(
            label: 'Converted amount (${_info(_to).code})',
            value: formatMoney(convertCurrency(amount, rate), symbol: '${_info(_to).symbol} '),
            rows: [
              ('Amount', formatMoney(amount, symbol: '${_info(_from).symbol} ')),
              ('Exchange rate', '1 $_from = ${formatRate(rate)} $_to'),
              ('Rate used', own > 0 ? 'Your rate' : 'Approximate table'),
            ],
            note: 'Banks add charges and the market moves, so treat this as a guide.',
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class InvoiceNumberScreen extends StatefulWidget {
  const InvoiceNumberScreen({super.key});

  @override
  State<InvoiceNumberScreen> createState() => _InvoiceNumberScreenState();
}

class _InvoiceNumberScreenState extends CalcState<InvoiceNumberScreen> {
  late final _prefix = field('INV');
  late final _suffix = field();
  late final _start = field('1');
  late final _padding = field('5');
  late final _year = field('${DateTime.now().year}');
  late final _month = field(DateTime.now().month.toString().padLeft(2, '0'));
  late final _count = field('10');
  bool _includeYear = true;
  bool _includeMonth = false;
  List<String> _numbers = const [];

  List<String> _generate(int count) {
    String cut(String s) => s.length > 10 ? s.substring(0, 10) : s;
    final month = (int.tryParse(_month.text.trim()) ?? 1).clamp(1, 12).toString().padLeft(2, '0');
    return invoiceNumbers(
      prefix: cut(_prefix.text),
      suffix: cut(_suffix.text),
      start: (int.tryParse(_start.text.trim()) ?? 1).clamp(1, 999999999),
      padding: (int.tryParse(_padding.text.trim()) ?? 1).clamp(1, 10),
      count: count,
      year: _year.text.trim(),
      month: month,
      includeYear: _includeYear,
      includeMonth: _includeMonth,
    );
  }

  Future<void> _copy(String text) async {
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) showKToast(context, 'Copied');
  }

  @override
  Widget build(BuildContext context) {
    final preview = _generate(1).first;
    final count = (int.tryParse(_count.text.trim()) ?? 1).clamp(1, 100);
    return ToolScaffold(
      title: 'Invoice Number Generator',
      children: [
        KTextField(label: 'Prefix (like INV or BILL)', controller: _prefix, caps: true, hint: 'INV'),
        KTextField(label: 'Suffix (optional)', controller: _suffix, caps: true),
        KTextField(label: 'Start number', controller: _start, keyboard: TextInputType.number),
        KTextField(label: 'Zero padding (digits, 1 to 10)', controller: _padding, keyboard: TextInputType.number, hint: '5'),
        KToggleField(label: 'Include year', value: _includeYear, onChanged: (v) => setState(() => _includeYear = v)),
        if (_includeYear) KTextField(label: 'Year', controller: _year, keyboard: TextInputType.number),
        KToggleField(label: 'Include month', value: _includeMonth, onChanged: (v) => setState(() => _includeMonth = v)),
        if (_includeMonth) KTextField(label: 'Month (1 to 12)', controller: _month, keyboard: TextInputType.number),
        KTextField(label: 'How many numbers (1 to 100)', controller: _count, keyboard: TextInputType.number),
        ToolResult(label: 'First number', value: preview, tone: KTone.brand),
        KButton(label: 'Generate', icon: LucideIcons.refreshCw, onPressed: () => setState(() => _numbers = _generate(count))),
        if (_numbers.isNotEmpty) ...[
          KSectionHeader(
            'Generated ${_numbers.length} ${_numbers.length == 1 ? 'number' : 'numbers'}',
            trailing: KTextButton(label: 'Copy all', onTap: () => _copy(_numbers.join('\n'))),
          ),
          KCard(
            child: KDivided(children: [
              for (final n in _numbers)
                KListRow(
                  title: n,
                  trailing: const Icon(LucideIcons.copy, size: 18, color: AppColors.ink3),
                  onTap: () => _copy(n),
                ),
            ]),
          ),
        ],
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class GstCalculatorScreen extends StatefulWidget {
  const GstCalculatorScreen({super.key});

  @override
  State<GstCalculatorScreen> createState() => _GstCalculatorScreenState();
}

class _GstCalculatorScreenState extends CalcState<GstCalculatorScreen> {
  late final _amount = field();
  late final _rate = field('18');
  bool _inclusive = false;

  static const _rates = ['0', '5', '12', '18', '28'];

  @override
  Widget build(BuildContext context) {
    final amount = parseAmount(_amount.text);
    final rate = parseAmount(_rate.text);
    final rateBad = rate > 100;
    final split = amount > 0 && !rateBad ? gstSplit(amount, rate, inclusive: _inclusive) : null;
    final half = jsNumberString(rate / 2);
    return ToolScaffold(
      title: 'GST Calculator',
      children: [
        KSegmented<bool>(
          value: _inclusive,
          options: const [(false, 'GST exclusive'), (true, 'GST inclusive')],
          onChanged: (v) => setState(() => _inclusive = v),
        ),
        KAmountField(label: _inclusive ? 'Total amount (including GST)' : 'Base amount (excluding GST)', controller: _amount),
        KChipBar<String>(
          value: _rates.contains(_rate.text) ? _rate.text : null,
          padding: EdgeInsets.zero,
          options: [for (final r in _rates) (r, '$r%')],
          onChanged: (v) => setState(() => _rate.text = v),
        ),
        KNumberField(label: 'GST rate (%)', controller: _rate, hint: '18', error: rateBad ? 'Enter 100 or less' : null),
        if (split == null)
          const ToolHint('Enter an amount to see the GST, split into CGST, SGST and IGST.')
        else
          ToolResult(
            label: 'Total amount (incl. GST)',
            value: formatMoney(split.total),
            tone: KTone.positive,
            rows: [
              ('Base amount (excl. GST)', formatMoney(split.base)),
              ('Total GST (${jsNumberString(rate)}%)', formatMoney(split.gst)),
              ('CGST ($half%)', formatMoney(split.cgst)),
              ('SGST ($half%)', formatMoney(split.sgst)),
              ('IGST (${jsNumberString(rate)}%)', formatMoney(split.igst)),
            ],
            note: 'Use CGST and SGST within a state, IGST between states.',
          ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------------------------

class GstinValidatorScreen extends StatefulWidget {
  const GstinValidatorScreen({super.key});

  @override
  State<GstinValidatorScreen> createState() => _GstinValidatorScreenState();
}

class _GstinValidatorScreenState extends CalcState<GstinValidatorScreen> {
  late final _value = field();

  @override
  Widget build(BuildContext context) {
    final text = _value.text.trim().toUpperCase();
    return ToolScaffold(
      title: 'GSTIN Validator',
      children: [
        KTextField(
          label: 'GSTIN',
          controller: _value,
          caps: true,
          hint: '27AADCB2230M1ZV',
        ),
        _IdResult(text: text, length: 15, check: checkGstin),
        const ToolHint('This checks the format, the state code and the check character. It does not look the number up on the GST portal.'),
      ],
    );
  }
}

class PanValidatorScreen extends StatefulWidget {
  const PanValidatorScreen({super.key});

  @override
  State<PanValidatorScreen> createState() => _PanValidatorScreenState();
}

class _PanValidatorScreenState extends CalcState<PanValidatorScreen> {
  late final _value = field();

  @override
  Widget build(BuildContext context) {
    final text = _value.text.trim().toUpperCase();
    return ToolScaffold(
      title: 'PAN Validator',
      children: [
        KTextField(label: 'PAN', controller: _value, caps: true, hint: 'ABCDE1234F'),
        _IdResult(text: text, length: 10, check: checkPan),
        const ToolHint('This checks the format only. It does not look the PAN up with the income tax department.'),
      ],
    );
  }
}

/// Blank, "keep typing", or the verdict, once the number has its full length.
class _IdResult extends StatelessWidget {
  const _IdResult({required this.text, required this.length, required this.check});

  final String text;
  final int length;
  final IdCheck Function(String) check;

  @override
  Widget build(BuildContext context) {
    if (text.isEmpty) return const SizedBox.shrink();
    if (text.length < length) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: Text('${text.length} of $length characters', style: AppText.caption),
      );
    }
    final r = check(text);
    return VerdictCard(valid: r.valid, title: r.title, message: r.message, details: r.details);
  }
}
