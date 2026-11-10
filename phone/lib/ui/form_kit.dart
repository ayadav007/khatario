import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../format.dart';
import '../screens/docs/doc_logic.dart';
import '../theme.dart' hide inr;
import 'kit.dart';
import 'toast.dart';

/// Form fields and the form page that every create / edit screen on the phone is built from.
///
/// Fields draw their label above the box, on a white surface with a 1.5px hairline border
/// that turns brand coloured (2px) on focus.

OutlineInputBorder _border(Color color, double width) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.md),
      borderSide: BorderSide(color: color, width: width),
    );

/// Label above, [child] below, optional error line under it.
class _FieldFrame extends StatelessWidget {
  const _FieldFrame({required this.label, required this.child, this.error});

  final String label;
  final Widget child;
  final String? error;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(padding: const EdgeInsets.only(bottom: 6, left: 2), child: Text(label, style: AppText.label)),
        child,
        if (error != null && error!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 2),
            child: Text(error!, style: AppText.caption.copyWith(color: AppColors.negative)),
          )
      ],
    );
  }
}

InputDecoration _decoration({String? hint, String? error, Widget? prefix, Widget? suffix}) {
  final hasError = error != null && error.isNotEmpty;
  return InputDecoration(
    isDense: true,
    filled: true,
    fillColor: AppColors.surface,
    hintText: hint,
    hintStyle: AppText.body.copyWith(color: AppColors.ink3),
    prefixIcon: prefix,
    prefixIconConstraints: const BoxConstraints(minWidth: 0, minHeight: 0),
    suffixIcon: suffix,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    border: _border(hasError ? AppColors.negative : AppColors.hairline, 1.5),
    enabledBorder: _border(hasError ? AppColors.negative : AppColors.hairline, 1.5),
    focusedBorder: _border(hasError ? AppColors.negative : AppColors.brand, 2),
  );
}

/// Upper-cases whatever is typed or pasted.
final TextInputFormatter _upperCase = TextInputFormatter.withFunction((old, next) {
  final text = next.text.toUpperCase();
  if (text == next.text) return next;
  if (text.length == next.text.length) return next.copyWith(text: text);
  return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
});

/// Keyboards for emails, links, numbers and secrets never start with a capital.
bool _noCapsFor(TextInputType? k) =>
    k == TextInputType.emailAddress ||
    k == TextInputType.url ||
    k == TextInputType.number ||
    k == TextInputType.phone ||
    k == TextInputType.visiblePassword;

/// Single or multi line text.
class KTextField extends StatelessWidget {
  const KTextField({
    super.key,
    required this.label,
    required this.controller,
    this.hint,
    this.error,
    this.maxLines = 1,
    this.keyboard,
    this.caps = false,
    this.onChanged,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? error;
  final int maxLines;
  final TextInputType? keyboard;

  /// Capital letters only (GSTIN, PAN, codes).
  final bool caps;
  final ValueChanged<String>? onChanged;

  @override
  Widget build(BuildContext context) {
    return _FieldFrame(
      label: label,
      error: error,
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        maxLines: maxLines,
        minLines: 1,
        keyboardType: keyboard ?? (maxLines > 1 ? TextInputType.multiline : null),
        textCapitalization: caps ? TextCapitalization.characters : (_noCapsFor(keyboard) ? TextCapitalization.none : TextCapitalization.sentences),
        inputFormatters: caps ? [_upperCase] : null,
        style: AppText.body,
        cursorColor: AppColors.ink,
        decoration: _decoration(hint: hint, error: error),
      ),
    );
  }
}

/// Keeps digits and the first dot, and at most two decimals.
TextEditingValue _money(TextEditingValue old, TextEditingValue next) {
  final raw = next.text.replaceAll(RegExp(r'[^0-9.]'), '');
  final dot = raw.indexOf('.');
  final text = dot == -1
      ? raw
      : () {
          final decimals = raw.substring(dot + 1).replaceAll('.', '');
          return '${raw.substring(0, dot)}.${decimals.length > 2 ? decimals.substring(0, 2) : decimals}';
        }();
  if (text == next.text) return next;
  return TextEditingValue(text: text, selection: TextSelection.collapsed(offset: text.length));
}

/// Money entry: decimal keyboard, at most two places, rupee sign in front.
class KAmountField extends StatelessWidget {
  const KAmountField({super.key, required this.label, required this.controller, this.error});

  final String label;
  final TextEditingController controller;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final style = AppText.body.copyWith(fontFeatures: AppText.tabular);
    return _FieldFrame(
      label: label,
      error: error,
      child: TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [TextInputFormatter.withFunction(_money)],
        style: style,
        cursorColor: AppColors.ink,
        decoration: _decoration(
          hint: '0',
          error: error,
          prefix: Padding(
            padding: const EdgeInsets.only(left: 14, right: 6),
            child: Text(rupeeSign, style: style.copyWith(color: AppColors.ink2, fontWeight: FontWeight.w600)),
          ),
        ),
      ),
    );
  }
}

/// The tappable box used by the date, pick and async pick fields.
class _TapBox extends StatelessWidget {
  const _TapBox({required this.text, required this.onTap, this.placeholder = 'Select', this.icon = LucideIcons.chevronDown});

  final String? text;
  final String placeholder;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final empty = text == null || text!.isEmpty;
    return Semantics(
      container: true,
      button: true,
      child: Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          side: const BorderSide(color: AppColors.hairline, width: 1.5),
        ),
        child: InkWell(
          customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 50),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      empty ? placeholder : text!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.body.copyWith(color: empty ? AppColors.ink3 : AppColors.ink),
                    ),
                  ),
                  const SizedBox(width: AppSpace.sm),
                  Icon(icon, size: 18, color: AppColors.ink3),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A date chosen in the system calendar.
class KDateField extends StatelessWidget {
  const KDateField({super.key, required this.label, required this.value, required this.onChanged, this.first, this.last});

  final String label;
  final DateTime? value;
  final ValueChanged<DateTime> onChanged;
  final DateTime? first;
  final DateTime? last;

  Future<void> _pick(BuildContext context) async {
    final now = DateTime.now();
    final lo = first ?? DateTime(now.year - 10);
    final hi = last ?? DateTime(now.year + 10, 12, 31);
    var initial = value ?? now;
    if (initial.isBefore(lo)) initial = lo;
    if (initial.isAfter(hi)) initial = hi;
    final picked = await showDatePicker(context: context, initialDate: initial, firstDate: lo, lastDate: hi);
    if (picked != null) onChanged(picked);
  }

  @override
  Widget build(BuildContext context) {
    return _FieldFrame(
      label: label,
      child: _TapBox(
        text: value == null ? null : ddMMMyyyy(value!),
        placeholder: 'Select date',
        icon: LucideIcons.calendar,
        onTap: () => _pick(context),
      ),
    );
  }
}

/// One choice from a list, picked in a bottom sheet. [searchable] adds a search box.
class KPickField<T> extends StatelessWidget {
  const KPickField({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    this.searchable = false,
  });

  final String label;
  final T? value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;
  final bool searchable;

  String? get _current {
    for (final (v, text) in options) {
      if (v == value) return text;
    }
    return null;
  }

  Future<void> _open(BuildContext context) async {
    if (searchable) {
      final picked = await showKSheet<_Picked<T>>(
        context,
        title: label,
        builder: (ctx) => _SearchableOptions<T>(options: options, value: value),
      );
      if (picked != null && picked.value != value) onChanged(picked.value);
      return;
    }
    // showKPicker needs a non-null current value; a nullable one lets "no choice yet" through.
    await showKPicker<T?>(
      context,
      title: label,
      value: value,
      options: [for (final (v, text) in options) (v as T?, text)],
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return _FieldFrame(label: label, child: _TapBox(text: _current, onTap: () => _open(context)));
  }
}

/// Wraps a pick so a null-able T still tells "closed" (null) from "picked".
class _Picked<T> {
  const _Picked(this.value);
  final T value;
}

class _SearchableOptions<T> extends StatefulWidget {
  const _SearchableOptions({required this.options, required this.value});

  final List<(T, String)> options;
  final T? value;

  @override
  State<_SearchableOptions<T>> createState() => _SearchableOptionsState<T>();
}

class _SearchableOptionsState<T> extends State<_SearchableOptions<T>> {
  final _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final q = _query.text.trim().toLowerCase();
    final shown = [
      for (final o in widget.options)
        if (q.isEmpty || o.$2.toLowerCase().contains(q)) o,
    ];
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: KSearchField(controller: _query, hint: 'Search', onChanged: (_) => setState(() {})),
          ),
          Expanded(
            child: shown.isEmpty
                ? const KEmptyState(icon: LucideIcons.searchX, title: 'No matches')
                : ListView(
                    children: [
                      for (final (v, text) in shown)
                        KListRow(
                          title: text,
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                          trailing: v == widget.value ? Icon(LucideIcons.check, size: 20, color: AppColors.brand) : null,
                          onTap: () => Navigator.of(context).pop(_Picked<T>(v)),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

/// A record found on the server (customer, supplier, item, account, employee), picked from a
/// searchable sheet. [search] gets the typed text, '' for the first list.
class KAsyncPickField extends StatelessWidget {
  const KAsyncPickField({
    super.key,
    required this.label,
    required this.valueLabel,
    required this.search,
    required this.onPicked,
  });

  final String label;
  final String? valueLabel;
  final Future<List<(String id, String label, String sub)>> Function(String query) search;
  final void Function(String id, String label) onPicked;

  Future<void> _open(BuildContext context) async {
    final picked = await showKSheet<(String, String)>(
      context,
      title: label,
      builder: (ctx) => _AsyncOptions(search: search),
    );
    if (picked != null) onPicked(picked.$1, picked.$2);
  }

  @override
  Widget build(BuildContext context) {
    return _FieldFrame(label: label, child: _TapBox(text: valueLabel, onTap: () => _open(context)));
  }
}

class _AsyncOptions extends StatefulWidget {
  const _AsyncOptions({required this.search});

  final Future<List<(String, String, String)>> Function(String query) search;

  @override
  State<_AsyncOptions> createState() => _AsyncOptionsState();
}

class _AsyncOptionsState extends State<_AsyncOptions> {
  final _query = TextEditingController();
  Timer? _debounce;
  int _ticket = 0;
  bool _loading = true;
  String? _error;
  List<(String, String, String)> _rows = const [];

  @override
  void initState() {
    super.initState();
    _run('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _typed(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => _run(text.trim()));
  }

  Future<void> _run(String q) async {
    final ticket = ++_ticket;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await widget.search(q);
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _rows = rows;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _error = 'Could not search. Try again.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (_loading) {
      body = const KSpinner();
    } else if (_error != null) {
      body = KEmptyState(
        icon: LucideIcons.circleAlert,
        title: _error!,
        action: KButton(label: 'Try again', expand: false, kind: KButtonKind.secondary, onPressed: () => _run(_query.text.trim())),
      );
    } else if (_rows.isEmpty) {
      body = const KEmptyState(icon: LucideIcons.searchX, title: 'No matches');
    } else {
      body = ListView(
        children: [
          for (final (id, label, sub) in _rows)
            KListRow(
              title: label,
              subtitle: sub,
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
              onTap: () => Navigator.of(context).pop((id, label)),
            ),
        ],
      );
    }
    return SizedBox(
      height: MediaQuery.sizeOf(context).height * 0.6,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
            child: KSearchField(controller: _query, hint: 'Search', onChanged: _typed),
          ),
          Expanded(child: body),
        ],
      ),
    );
  }
}

/// On / off with a label and a line of help.
class KToggleField extends StatelessWidget {
  const KToggleField({super.key, required this.label, required this.value, required this.onChanged, this.help});

  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;
  final String? help;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      toggled: value,
      label: label,
      child: Material(
        color: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadius.md),
          side: const BorderSide(color: AppColors.hairline, width: 1.5),
        ),
        child: InkWell(
          customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
          onTap: () => onChanged(!value),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: AppText.body.copyWith(fontWeight: FontWeight.w500)),
                      if (help != null && help!.isNotEmpty) ...[const SizedBox(height: 2), Text(help!, style: AppText.caption)],
                    ],
                  ),
                ),
                const SizedBox(width: AppSpace.md),
                Switch(
                  value: value,
                  activeTrackColor: AppColors.brand,
                  inactiveTrackColor: AppColors.hairline,
                  inactiveThumbColor: AppColors.surface,
                  trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
                  onChanged: onChanged,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A titled group of fields.
class KFormSection extends StatelessWidget {
  const KFormSection({super.key, required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KSectionHeader(title),
        for (final (i, c) in children.indexed) ...[
          if (i > 0) const SizedBox(height: AppSpace.md),
          c,
        ],
      ],
    );
  }
}

/// A form page: back bar, scrolling fields, save button pinned to the bottom.
///
/// [onSave] does the work and pops the page itself when it succeeds. If it throws, the page
/// stays as it is with every field kept: an [ApiException] shows the server's text, anything
/// else a plain message. While it runs the button shows a spinner and taps are ignored.
class KFormScaffold extends StatefulWidget {
  const KFormScaffold({
    super.key,
    required this.title,
    required this.saveLabel,
    required this.onSave,
    required this.children,
    this.dirty = false,
    this.canSave = true,
  });

  final String title;
  final String saveLabel;
  final Future<void> Function() onSave;
  final List<Widget> children;

  /// Unsaved edits: going back asks "Discard changes?" first.
  final bool dirty;

  /// False greys the save button out (a form that cannot be posted yet).
  final bool canSave;

  @override
  State<KFormScaffold> createState() => _KFormScaffoldState();
}

class _KFormScaffoldState extends State<KFormScaffold> {
  bool _saving = false;

  Future<void> _save() async {
    if (_saving) return;
    _saving = true;
    setState(() {});
    try {
      await widget.onSave();
    } on ApiException catch (e) {
      if (mounted) showKToast(context, e.message, tone: KTone.negative);
    } catch (_) {
      if (mounted) showKToast(context, 'Could not save. Try again.', tone: KTone.negative);
    } finally {
      _saving = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _confirmLeave() async {
    final discard = await showKSheet<bool>(
      context,
      title: 'Discard changes?',
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KSheetAction(icon: LucideIcons.trash2, label: 'Discard', danger: true, onTap: () => Navigator.of(ctx).pop(true)),
          KSheetAction(icon: LucideIcons.pencil, label: 'Keep editing', onTap: () => Navigator.of(ctx).pop(false)),
        ],
      ),
    );
    if (discard == true && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !widget.dirty && !_saving,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && !_saving) _confirmLeave();
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          bottom: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(widget.title),
              Expanded(
                child: ListView(
                  keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.sm, AppSpace.gutter, AppSpace.xl),
                  children: [
                    for (final (i, c) in widget.children.indexed) ...[
                      if (i > 0) const SizedBox(height: AppSpace.md),
                      c,
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: KBottomBar(
          children: [
            Expanded(child: KButton(label: widget.saveLabel, loading: _saving, onPressed: _saving || !widget.canSave ? null : _save)),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Searches behind the async pick fields. Each returns (id, label, second line). The server
// scopes every request to the signed-in business; none sends a business id.
// ---------------------------------------------------------------------------------------------

const _searchLimit = '30';

String _path(String path, Map<String, String> query) => Uri(path: path, queryParameters: query).toString();

String _join(Iterable<String> parts) => parts.where((p) => p.isNotEmpty).join(' · ');

List<(String, String, String)> _rows(
  dynamic body,
  String key,
  String Function(Map<String, dynamic> r) label,
  String Function(Map<String, dynamic> r) sub,
) {
  return [
    for (final r in docRows(body, key))
      if (docText(r['id']).isNotEmpty) (docText(r['id']), label(r), sub(r)),
  ];
}

/// `GET /api/customers?search=` -> `{customers: [...]}`.
Future<List<(String, String, String)>> searchCustomers(KhatarioApi api, String q) async {
  final text = q.trim();
  final body = await api.getData(_path('/api/customers', {if (text.isNotEmpty) 'search': text, 'limit': _searchLimit}));
  return _rows(body, 'customers', (r) => docText(r['name']), (r) => _join([docText(r['phone']), docText(r['gstin'])]));
}

/// `GET /api/suppliers?search=` -> `{suppliers: [...]}`.
Future<List<(String, String, String)>> searchSuppliers(KhatarioApi api, String q) async {
  final text = q.trim();
  final body = await api.getData(_path('/api/suppliers', {if (text.isNotEmpty) 'search': text, 'limit': _searchLimit}));
  return _rows(body, 'suppliers', (r) => docText(r['name']), (r) => _join([docText(r['phone']), docText(r['gstin'])]));
}

/// `GET /api/items/search?q=` -> `{items: [...]}`. A blank query lists the catalogue (`browse=1`),
/// because the route returns nothing without text.
Future<List<(String, String, String)>> searchItems(KhatarioApi api, String q) async {
  final text = q.trim();
  final body = await api.getData(_path('/api/items/search', text.isEmpty ? {'browse': '1', 'limit': _searchLimit} : {'q': text, 'limit': _searchLimit}));
  return _rows(body, 'items', (r) => docText(r['name']), (r) {
    final price = docNum(r['selling_price']);
    final line = _join([docText(r['unit']), if (price != null) inr(price, maxFraction: 2)]);
    return line.isNotEmpty ? line : docText(r['code']);
  });
}

/// `GET /api/accounts?search=` -> `{accounts: [...]}` (no paging parameters: the route then
/// returns every match).
Future<List<(String, String, String)>> searchAccounts(KhatarioApi api, String q) async {
  final text = q.trim();
  final body = await api.getData(_path('/api/accounts', {if (text.isNotEmpty) 'search': text, 'is_active': 'true'}));
  return _rows(body, 'accounts', (r) => docText(r['account_name']), (r) {
    final group = docText(r['account_group_name']);
    return _join([docText(r['account_code']), group.isNotEmpty ? group : docText(r['account_type'])]);
  });
}

/// `GET /api/employees?search=` -> `{employees: [...]}`.
Future<List<(String, String, String)>> searchEmployees(KhatarioApi api, String q) async {
  final text = q.trim();
  final body = await api.getData(_path('/api/employees', {if (text.isNotEmpty) 'search': text, 'status': 'active', 'limit': '50'}));
  return _rows(body, 'employees', (r) {
    final name = docText(r['user_name']);
    return name.isNotEmpty ? name : docText(r['name']);
  }, (r) {
    final role = docText(r['designation']);
    return role.isNotEmpty ? role : docText(r['employee_code']);
  });
}
