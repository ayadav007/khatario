import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../api.dart';
import '../theme.dart';
import '../ui/kit.dart';
import '../ui/web_ui.dart';

/// Phone copy of `app/signup/page.tsx`: details, WhatsApp code, then the account.
class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key, required this.api, required this.onSignedIn});

  final Future<KhatarioApi> Function() api;
  final Future<void> Function() onSignedIn;

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _businessName = TextEditingController();
  final _businessPhone = TextEditingController();
  final _businessEmail = TextEditingController();
  final _userName = TextEditingController();
  final _userPhone = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();

  String _businessType = '';
  String _industry = '';
  String _businessModel = '';
  bool _otp = false;
  bool _loading = false;
  String _error = '';
  String _info = '';

  static const _types = [
    ('retail', 'Retail'),
    ('wholesaler', 'Wholesaler'),
    ('distributor', 'Distributor'),
    ('manufacturer', 'Manufacturer'),
    ('service', 'Service'),
    ('other', 'Other'),
  ];
  static const _industries = [
    ('pharmaceuticals', 'Pharmaceuticals'),
    ('textiles', 'Textiles'),
    ('garments', 'Garments'),
    ('electronics', 'Electronics'),
    ('food_beverages', 'Food & Beverages'),
    ('automotive', 'Automotive'),
    ('construction', 'Construction'),
    ('services', 'Services'),
    ('other', 'Other'),
  ];
  static const _models = [
    ('', 'Select'),
    ('b2b', 'B2B'),
    ('b2c', 'B2C'),
    ('b2b2c', 'B2B2C'),
    ('export', 'Export'),
    ('mixed', 'Mixed'),
  ];

  @override
  void dispose() {
    for (final c in [_businessName, _businessPhone, _businessEmail, _userName, _userPhone, _password, _code]) {
      c.dispose();
    }
    super.dispose();
  }

  String get _phone10 {
    final digits = _userPhone.text.replaceAll(RegExp(r'\D'), '');
    return digits.length >= 10 ? digits.substring(digits.length - 10) : digits;
  }

  Future<void> _sendCode() async {
    setState(() {
      _error = '';
      _info = '';
    });
    if (_businessName.text.trim().isEmpty || _userName.text.trim().isEmpty || _password.text.isEmpty || _businessType.isEmpty || _industry.isEmpty) {
      setState(() => _error = 'Fill in the business name, type, industry, your name and a password');
      return;
    }
    if (_phone10.length != 10) {
      setState(() => _error = 'Enter a valid 10-digit mobile number');
      return;
    }
    setState(() => _loading = true);
    try {
      final api = await widget.api();
      final data = await api.postJson('/api/public/platform-otp', {
        'action': 'request',
        'purpose': 'signup',
        'phone': _phone10,
      });
      final debug = data['debugOtp']?.toString();
      setState(() {
        _otp = true;
        _info = debug == null || debug.isEmpty ? 'We sent a code on WhatsApp.' : 'Staging code: $debug';
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message.isEmpty ? 'Could not send the code' : e.message);
    } catch (_) {
      setState(() => _error = 'Could not send the code');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _create() async {
    setState(() => _error = '');
    if (!RegExp(r'^\d{6}$').hasMatch(_code.text.trim())) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() => _loading = true);
    try {
      final api = await widget.api();
      await api.postJson('/api/public/platform-otp', {
        'action': 'verify',
        'purpose': 'signup',
        'phone': _phone10,
        'code': _code.text.trim(),
      });
      await api.postJson('/api/signup', {
        'businessName': _businessName.text.trim(),
        'businessPhone': _businessPhone.text.trim(),
        'businessEmail': _businessEmail.text.trim(),
        'businessType': _businessType,
        'industry': _industry,
        if (_businessModel.isNotEmpty) 'businessModel': _businessModel,
        'userName': _userName.text.trim(),
        'userPhone': _phone10,
        'password': _password.text,
        'productLine': 'billing',
      });
      await widget.onSignedIn();
    } on ApiException catch (e) {
      setState(() => _error = e.message.isEmpty ? 'Could not create the account' : e.message);
    } catch (_) {
      setState(() => _error = 'Could not create the account');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pick(String title, List<(String, String)> options, String current, ValueChanged<String> onPicked) async {
    final choice = await showKSheet<String>(
      context,
      title: title,
      builder: (ctx) => ListView(
        shrinkWrap: true,
        children: [
          for (final (value, label) in options)
            if (value.isNotEmpty)
              ListTile(
                title: Text(label),
                trailing: value == current ? const Icon(LucideIcons.check, size: 18) : null,
                onTap: () => Navigator.pop(ctx, value),
              ),
        ],
      ),
    );
    if (choice != null) onPicked(choice);
  }

  String _label(List<(String, String)> options, String value, String empty) {
    for (final option in options) {
      if (option.$1 == value && value.isNotEmpty) return option.$2;
    }
    return empty;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      appBar: AppBar(title: const Text('Create an account')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
        children: [
          Text(
            _otp ? 'Enter the WhatsApp code' : 'Tell us about the business, then we confirm the mobile number.',
            style: AppText.body.copyWith(color: AppColors.ink2),
          ),
          const SizedBox(height: 16),
          if (_info.isNotEmpty) ...[
            Text(_info, style: AppText.body.copyWith(color: AppColors.positive)),
            const SizedBox(height: 12),
          ],
          if (_error.isNotEmpty) ...[
            Text(_error, style: AppText.body.copyWith(color: AppColors.negative)),
            const SizedBox(height: 12),
          ],
          if (_otp) ...[
            WebInput(label: 'WhatsApp code', controller: _code, placeholder: '6 digits', keyboardType: TextInputType.number, maxLength: 6, digitsOnly: true),
            const SizedBox(height: 16),
            KButton(label: 'Create account', loading: _loading, onPressed: _create),
            const SizedBox(height: 8),
            KButton.secondary(label: 'Edit details', onPressed: _loading ? null : () => setState(() => _otp = false)),
          ] else ...[
            WebInput(label: 'Business name', controller: _businessName, placeholder: 'Company name'),
            const SizedBox(height: 12),
            WebInput(label: 'Business phone (optional)', controller: _businessPhone, keyboardType: TextInputType.phone),
            const SizedBox(height: 12),
            WebInput(label: 'Business email (optional)', controller: _businessEmail, keyboardType: TextInputType.emailAddress),
            const SizedBox(height: 12),
            _pickRow('Business type', _label(_types, _businessType, 'Select'), () => _pick('Business type', _types, _businessType, (v) => setState(() => _businessType = v))),
            const SizedBox(height: 12),
            _pickRow('Industry', _label(_industries, _industry, 'Select'), () => _pick('Industry', _industries, _industry, (v) => setState(() => _industry = v))),
            const SizedBox(height: 12),
            _pickRow('Business model (optional)', _label(_models, _businessModel, 'Select'), () => _pick('Business model', _models, _businessModel, (v) => setState(() => _businessModel = v))),
            const SizedBox(height: 20),
            Text('Your account', style: AppText.label),
            const SizedBox(height: 12),
            WebInput(label: 'Your name', controller: _userName, placeholder: 'Your name'),
            const SizedBox(height: 12),
            WebInput(label: 'Mobile number', controller: _userPhone, placeholder: '10-digit mobile', keyboardType: TextInputType.phone, maxLength: 10, digitsOnly: true),
            const SizedBox(height: 12),
            WebInput(label: 'Password', controller: _password, placeholder: 'Password', obscureText: true),
            const SizedBox(height: 16),
            KButton(label: 'Send WhatsApp code', loading: _loading, onPressed: _sendCode),
            const SizedBox(height: 12),
            Text(
              'Creating an account means you agree to the Khatario terms. Questions go to support@khatario.com.',
              style: AppText.caption.copyWith(color: AppColors.ink3),
            ),
          ],
        ],
      ),
    );
  }

  Widget _pickRow(String label, String value, VoidCallback onTap) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppText.label),
        const SizedBox(height: 6),
        Material(
          color: AppColors.sunken,
          borderRadius: BorderRadius.circular(AppRadius.sm),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadius.sm),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
              child: Row(
                children: [
                  Expanded(child: Text(value, style: AppText.body)),
                  const Icon(LucideIcons.chevronDown, size: 18, color: AppColors.ink3),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
