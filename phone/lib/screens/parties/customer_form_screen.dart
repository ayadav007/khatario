import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../api.dart';
import '../../capability.dart';
import '../../session.dart';
import '../../format.dart';
import '../../ui/kit.dart';
import '../../theme.dart';
import 'customer_form_logic.dart';

/// New and edit customer forms from `customers/new` and `customers/[id]/edit`.
class CustomerFormScreen extends StatefulWidget {
  const CustomerFormScreen({super.key, required this.session, required this.capabilities, this.customerId});

  final AppSession session;
  final Capabilities? capabilities;

  /// Null creates a customer. Set to edit.
  final String? customerId;

  bool get editing => customerId != null;

  @override
  State<CustomerFormScreen> createState() => _CustomerFormScreenState();
}

class _CustomerFormScreenState extends State<CustomerFormScreen> {
  final _name = TextEditingController();
  final _company = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _gstin = TextEditingController();
  final _billing = TextEditingController();
  final _shipping = TextEditingController();
  final _city = TextEditingController();
  final _pincode = TextEditingController();
  final _opening = TextEditingController();
  final _creditLimit = TextEditingController();
  final _creditDays = TextEditingController();

  String _state = '';
  String _country = 'India';
  String _openingType = 'debit';
  bool _sameAsBilling = false;
  bool _loading = false;
  bool _saving = false;
  bool _missing = false;
  String? _gstinNote;
  bool _gstinError = false;
  bool _gstinVerified = false;
  ({String field, String message})? _duplicate;
  ({num current, num limit})? _limit;

  bool get _canSubmit {
    final caps = widget.capabilities;
    if (caps == null) return false;
    return caps.has('customers', widget.editing ? 'update' : 'create');
  }

  @override
  void initState() {
    super.initState();
    if (widget.editing) {
      _loading = true;
      _load();
    } else {
      _checkLimit();
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _company, _phone, _email, _gstin, _billing, _shipping, _city, _pincode, _opening, _creditLimit, _creditDays]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final body = await widget.session.api.getJson('/api/customers/${widget.customerId}');
      final raw = body['customer'];
      if (raw is! Map || !mounted) {
        setState(() {
          _missing = true;
          _loading = false;
        });
        return;
      }
      final c = Map<String, dynamic>.from(raw);
      _name.text = c['name']?.toString() ?? '';
      _phone.text = c['phone']?.toString() ?? '';
      _email.text = c['email']?.toString() ?? '';
      _gstin.text = c['gstin']?.toString() ?? '';
      _billing.text = (c['billing_address'] ?? c['address'])?.toString() ?? '';
      _shipping.text = (c['shipping_address'] ?? c['address'])?.toString() ?? '';
      _city.text = c['city']?.toString() ?? '';
      _state = c['state']?.toString() ?? '';
      _pincode.text = c['pincode']?.toString() ?? '';
      _country = c['country']?.toString().isNotEmpty == true ? c['country'].toString() : 'India';
      _opening.text = c['opening_balance']?.toString() ?? '0';
      _openingType = c['opening_balance_type']?.toString() ?? 'debit';
      _creditLimit.text = c['credit_limit']?.toString() ?? '0';
      _creditDays.text = c['credit_days'] == null ? '' : c['credit_days'].toString();
      final expected = buildShippingAddress(_billing.text, _city.text, _state, _pincode.text);
      _sameAsBilling = _shipping.text.trim() == expected.trim();
      if (mounted) setState(() => _loading = false);
    } catch (_) {
      if (mounted) {
        setState(() {
          _missing = true;
          _loading = false;
        });
      }
    }
  }

  Future<void> _checkLimit() async {
    try {
      final body = await widget.session.api.getJson('/api/subscriptions/check-limit?limit_type=customers');
      if (!mounted) return;
      setState(() => _limit = (current: _num(body['current']), limit: _num(body['limit'])));
      if (body['allowed'] == false) _showLimit();
    } catch (_) {}
  }

  num _num(dynamic value) {
    if (value is num) return value;
    return num.tryParse(value?.toString() ?? '') ?? 0;
  }

  void _showLimit() {
    final info = _limit;
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Customer limit reached'),
        content: Text(info == null ? 'Your plan does not allow another customer.' : 'You have ${info.current} of ${info.limit} customers.'),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close'))],
      ),
    );
  }

  bool get _atLimit {
    final info = _limit;
    return info != null && info.limit != -1 && info.current >= info.limit;
  }

  void _syncShipping() {
    if (!_sameAsBilling) return;
    _shipping.text = buildShippingAddress(_billing.text, _city.text, _state, _pincode.text);
  }

  Future<void> _fetchGstin() async {
    final gstin = _gstin.text.trim().toUpperCase();
    if (gstin.length != 15 || !isValidGstin(gstin)) {
      setState(() {
        _gstinError = true;
        _gstinVerified = false;
        _gstinNote = 'Invalid GSTIN format';
      });
      return;
    }
    setState(() {
      _gstinError = false;
      _gstinVerified = false;
      _gstinNote = null;
    });
    try {
      final data = await widget.session.api.getJson('/api/gstin/lookup?gstin=$gstin');
      if (!mounted) return;
      final hasDetails = data['legal_name'] != null && data['legal_name'].toString().isNotEmpty;
      if (data['api_configured'] != false && hasDetails) {
        setState(() {
          _gstinVerified = true;
          _gstinNote = 'Verified • Details auto-filled';
          if (data['legal_name'] != null || data['trade_name'] != null) {
            _name.text = (data['legal_name'] ?? data['trade_name']).toString();
          }
          if (data['address'] != null) _billing.text = data['address'].toString();
          if (data['city'] != null) _city.text = data['city'].toString();
          if (data['state'] != null) _state = data['state'].toString();
          if (data['pincode'] != null) _pincode.text = data['pincode'].toString();
        });
        _syncShipping();
      } else {
        final code = data['state_code']?.toString() ?? '';
        final name = gstStateName(code);
        setState(() {
          _gstinNote = 'GSTIN format valid • API verification unavailable • You can still proceed';
          if (name.isNotEmpty) _state = name;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _gstinNote = 'GSTIN format valid • API verification unavailable • You can still proceed');
      }
    }
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Customer name is required')));
      return;
    }
    if (!widget.editing && _atLimit) {
      _showLimit();
      return;
    }
    setState(() => _saving = true);
    try {
      if (widget.editing) {
        await widget.session.api.putJson(
          '/api/customers/${widget.customerId}',
          customerUpdateBody(
            name: _name.text,
            phone: _phone.text,
            email: _email.text,
            gstin: _gstin.text,
            billingAddress: _billing.text,
            shippingAddress: _shipping.text,
            city: _city.text,
            state: _state,
            pincode: _pincode.text,
            country: _country,
            openingBalance: _opening.text,
            openingBalanceType: _openingType,
            creditLimit: _creditLimit.text,
            creditDays: _creditDays.text,
          ),
        );
      } else {
        final data = await widget.session.api.postJson(
          '/api/customers',
          customerCreateBody(
            name: _name.text,
            companyName: _company.text,
            phone: _phone.text,
            email: _email.text,
            gstin: _gstin.text,
            billingAddress: _billing.text,
            shippingAddress: _shipping.text,
            city: _city.text,
            state: _state,
            pincode: _pincode.text,
            country: _country,
            openingBalance: _opening.text,
            openingBalanceType: _openingType,
            creditLimit: _creditLimit.text,
            creditDays: _creditDays.text,
          ),
        );
        if (data['deduplicated'] == true) {
          final code = data['code']?.toString();
          final message = data['error']?.toString() ?? 'A customer with these details already exists.';
          if (mounted) {
            setState(() => _duplicate = (field: code == 'DUPLICATE_EMAIL' ? 'email' : 'phone', message: message));
            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
          }
          return;
        }
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(widget.editing ? 'Failed to update customer' : 'Failed to save customer. Please try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final caps = widget.capabilities;
    final title = widget.editing ? 'Edit customer' : 'Add new customer';
    Widget frame(Widget body, {Widget? bottom}) => Scaffold(
      backgroundColor: AppColors.bg,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: 64,
              child: Row(
                children: [
                  const SizedBox(width: 4),
                  KIconButton(icon: LucideIcons.x, tooltip: 'Close', onTap: () => Navigator.pop(context)),
                  const SizedBox(width: 4),
                  Expanded(child: Text(title, style: AppText.heading.copyWith(fontSize: 18))),
                ],
              ),
            ),
            Expanded(child: body),
            ?bottom,
          ],
        ),
      ),
    );
    if (caps != null && !_canSubmit) {
      final action = widget.editing ? 'modify' : 'create';
      return frame(
        Center(
          child: KEmptyState(
            icon: LucideIcons.lock,
            title: 'Access restricted',
            body:
                "You don't have permission to $action view or manage customers. Ask your organization admin to grant the right role in Settings → Roles.",
          ),
        ),
      );
    }
    if (_loading || caps == null) return frame(const KSpinner());
    if (_missing) return frame(const KEmptyState(icon: LucideIcons.userX, title: 'Customer not found'));

    final addressSummary = [_city.text.trim(), _state].where((p) => p.isNotEmpty).join(', ');
    final moneySummary = [
      if (_opening.text.trim().isNotEmpty) 'Opening $rupeeSign${_opening.text.trim()}',
      if (_creditLimit.text.trim().isNotEmpty) 'Limit $rupeeSign${_creditLimit.text.trim()}',
      if (_creditDays.text.trim().isNotEmpty) 'Net ${_creditDays.text.trim()} days',
    ].join(' · ');

    return frame(
      ListView(
        padding: const EdgeInsets.fromLTRB(AppSpace.gutter, AppSpace.xs, AppSpace.gutter, AppSpace.xl),
        children: [
          KCard(
            padding: const EdgeInsets.fromLTRB(14, 16, 14, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _field(_name, 'Customer name *', icon: LucideIcons.user, autofocus: !widget.editing),
                if (!widget.editing) ...[
                  const SizedBox(height: AppSpace.md),
                  _field(_company, 'Company name', icon: LucideIcons.building2),
                ],
                const SizedBox(height: AppSpace.md),
                _field(
                  _phone,
                  'Phone number',
                  icon: LucideIcons.phone,
                  keyboard: TextInputType.phone,
                  error: _duplicate?.field == 'phone' ? _duplicate!.message : null,
                  onChanged: (_) {
                    if (_duplicate?.field == 'phone') setState(() => _duplicate = null);
                  },
                ),
                const SizedBox(height: AppSpace.md),
                _field(
                  _email,
                  'Email',
                  icon: LucideIcons.mail,
                  keyboard: TextInputType.emailAddress,
                  error: _duplicate?.field == 'email' ? _duplicate!.message : null,
                  onChanged: (_) {
                    if (_duplicate?.field == 'email') setState(() => _duplicate = null);
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.md),
          _FoldSection(
            icon: LucideIcons.badgeCheck,
            tint: AppTints.indigo,
            title: 'GSTIN',
            summary: _gstin.text.trim().isEmpty ? 'Optional · auto-fill name and address' : _gstin.text.trim().toUpperCase(),
            initiallyOpen: _gstin.text.trim().isNotEmpty,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: _field(
                        _gstin,
                        'GSTIN',
                        maxLength: 15,
                        caps: true,
                        onChanged: (_) => setState(() {
                          _gstinVerified = false;
                          _gstinError = false;
                          _gstinNote = null;
                        }),
                      ),
                    ),
                    if (!widget.editing) ...[
                      const SizedBox(width: 8),
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: KButton.secondary(
                          label: 'Fetch',
                          icon: LucideIcons.sparkles,
                          expand: false,
                          height: 48,
                          onPressed: _gstin.text.trim().length == 15 ? _fetchGstin : null,
                        ),
                      ),
                    ],
                  ],
                ),
                if (_gstinNote != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    _gstinNote!,
                    style: AppText.caption.copyWith(
                      fontSize: 12,
                      color: _gstinError ? AppColors.negative : (_gstinVerified ? AppColors.positive : AppColors.ink2),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: AppSpace.md),
          _FoldSection(
            icon: LucideIcons.mapPin,
            tint: AppTints.teal,
            title: 'Address',
            summary: addressSummary.isEmpty ? 'For invoices, e-way bills and GST' : addressSummary,
            initiallyOpen: widget.editing && _billing.text.trim().isNotEmpty,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _field(_billing, 'Billing address', lines: 2, onChanged: (_) => setState(_syncShipping)),
                const SizedBox(height: AppSpace.md),
                Row(
                  children: [
                    Expanded(child: _field(_city, 'City', onChanged: (_) => setState(_syncShipping))),
                    const SizedBox(width: AppSpace.md),
                    Expanded(
                      child: _field(_pincode, 'Pincode', keyboard: TextInputType.number, onChanged: (_) => setState(_syncShipping)),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpace.md),
                _PickerField(
                  label: 'State',
                  value: _state.isEmpty ? 'Choose state' : _state,
                  muted: _state.isEmpty,
                  onTap: () => showKPicker<String>(
                    context,
                    title: 'State',
                    value: _state,
                    options: [for (final s in indianStates) (s, s)],
                    onChanged: (v) => setState(() {
                      _state = v;
                      _syncShipping();
                    }),
                  ),
                ),
                const SizedBox(height: AppSpace.md),
                _PickerField(
                  label: 'Country',
                  value: _country,
                  caption: 'Required for export invoices',
                  onTap: () => showKPicker<String>(
                    context,
                    title: 'Country',
                    value: _country,
                    options: [for (final c in customerCountries) (c, c)],
                    onChanged: (v) => setState(() => _country = v),
                  ),
                ),
                const SizedBox(height: AppSpace.md),
                Row(
                  children: [
                    Expanded(
                      child: Text('Ship to the same address', style: AppText.body.copyWith(fontWeight: FontWeight.w500)),
                    ),
                    Switch.adaptive(
                      value: _sameAsBilling,
                      activeTrackColor: AppColors.brand,
                      activeThumbColor: AppColors.onBrand,
                      onChanged: (v) => setState(() {
                        _sameAsBilling = v;
                        if (_sameAsBilling) _syncShipping();
                      }),
                    ),
                  ],
                ),
                if (!_sameAsBilling) ...[const SizedBox(height: AppSpace.sm), _field(_shipping, 'Shipping address', lines: 2)],
              ],
            ),
          ),
          const SizedBox(height: AppSpace.md),
          _FoldSection(
            icon: LucideIcons.wallet,
            tint: AppTints.amber,
            title: 'Opening balance & credit',
            summary: moneySummary.isEmpty ? 'Optional · for receivables and alerts' : moneySummary,
            initiallyOpen: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _field(_opening, 'Opening balance', keyboard: TextInputType.number, onChanged: (_) => setState(() {})),
                const SizedBox(height: AppSpace.sm),
                KSegmented<String>(
                  value: _openingType,
                  options: const [('debit', 'To Receive'), ('credit', 'To Pay')],
                  onChanged: (v) => setState(() => _openingType = v),
                ),
                const SizedBox(height: AppSpace.md),
                Row(
                  children: [
                    Expanded(
                      child: _field(_creditLimit, 'Credit limit', keyboard: TextInputType.number, onChanged: (_) => setState(() {})),
                    ),
                    const SizedBox(width: AppSpace.md),
                    Expanded(
                      child: _field(_creditDays, 'Credit days (Net)', keyboard: TextInputType.number, onChanged: (_) => setState(() {})),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
      bottom: KBottomBar(
        children: [
          Expanded(
            child: KButton(
              label: widget.editing ? 'Update customer' : 'Save customer',
              icon: LucideIcons.check,
              loading: _saving,
              onPressed: _save,
            ),
          ),
        ],
      ),
    );
  }

  /// Labelled text field in the app style.
  Widget _field(
    TextEditingController controller,
    String label, {
    IconData? icon,
    TextInputType? keyboard,
    String? error,
    int lines = 1,
    int? maxLength,
    bool caps = false,
    bool autofocus = false,
    ValueChanged<String>? onChanged,
  }) {
    OutlineInputBorder border(Color c, [double w = 1.5]) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.md),
      borderSide: BorderSide(color: c, width: w),
    );
    return TextField(
      controller: controller,
      keyboardType: keyboard,
      maxLines: lines,
      minLines: lines,
      maxLength: maxLength,
      autofocus: autofocus,
      textCapitalization: caps ? TextCapitalization.characters : TextCapitalization.sentences,
      onChanged: onChanged,
      style: AppText.body,
      cursorColor: AppColors.brand,
      decoration: InputDecoration(
        labelText: label,
        labelStyle: AppText.body.copyWith(color: AppColors.ink3),
        floatingLabelStyle: AppText.label.copyWith(color: AppColors.brand),
        prefixIcon: icon == null ? null : Icon(icon, size: 18, color: AppColors.ink3),
        errorText: error,
        counterText: '',
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        enabledBorder: border(AppColors.hairline),
        focusedBorder: border(AppColors.brand, 2),
        errorBorder: border(AppColors.negative),
        focusedErrorBorder: border(AppColors.negative, 2),
      ),
    );
  }
}

/// Card that shows a one-line summary until opened.
class _FoldSection extends StatefulWidget {
  const _FoldSection({
    required this.icon,
    required this.tint,
    required this.title,
    required this.summary,
    required this.child,
    this.initiallyOpen = false,
  });

  final IconData icon;
  final (Color, Color) tint;
  final String title;
  final String summary;
  final Widget child;
  final bool initiallyOpen;

  @override
  State<_FoldSection> createState() => _FoldSectionState();
}

class _FoldSectionState extends State<_FoldSection> {
  late bool _open = widget.initiallyOpen;

  @override
  Widget build(BuildContext context) {
    return KCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          KListRow(
            onTap: () => setState(() => _open = !_open),
            leading: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(color: widget.tint.$1, borderRadius: BorderRadius.circular(12)),
              child: Icon(widget.icon, size: 18, color: widget.tint.$2),
            ),
            title: widget.title,
            subtitle: widget.summary,
            trailing: AnimatedRotation(
              turns: _open ? 0.5 : 0,
              duration: const Duration(milliseconds: 180),
              child: const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
            ),
          ),
          if (_open) Padding(padding: const EdgeInsets.fromLTRB(14, 4, 14, 16), child: widget.child),
        ],
      ),
    );
  }
}

/// Looks like a field, opens a picker sheet.
class _PickerField extends StatelessWidget {
  const _PickerField({required this.label, required this.value, required this.onTap, this.muted = false, this.caption});

  final String label;
  final String value;
  final String? caption;
  final bool muted;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.md),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 8, 10, 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: AppColors.hairline, width: 1.5),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: AppText.label.copyWith(fontSize: 12)),
                    Text(value, style: AppText.body.copyWith(color: muted ? AppColors.ink3 : AppColors.ink)),
                    if (caption != null) Text(caption!, style: AppText.caption.copyWith(fontSize: 11)),
                  ],
                ),
              ),
              const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
            ],
          ),
        ),
      ),
    );
  }
}
