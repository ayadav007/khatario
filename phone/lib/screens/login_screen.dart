import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';
import '../theme.dart';
import '../ui/kit.dart';
import '../ui/web_ui.dart';

/// Sign in (`app/login/page.tsx` flow): phone, then password, plus the two-code password reset.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.api, required this.onSignedIn});

  final Future<KhatarioApi> Function() api;
  final Future<void> Function() onSignedIn;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

enum _Mode { login, forgotRequest, forgotVerify }

class _LoginScreenState extends State<LoginScreen> {
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _resetEmail = TextEditingController();
  final _whatsappCode = TextEditingController();
  final _emailCode = TextEditingController();
  final _newPassword = TextEditingController();
  final _confirmPassword = TextEditingController();

  String _step = 'phone';
  _Mode _mode = _Mode.login;
  bool _loading = false;
  String _error = '';
  String _info = '';

  @override
  void dispose() {
    for (final c in [_phone, _password, _resetEmail, _whatsappCode, _emailCode, _newPassword, _confirmPassword]) {
      c.dispose();
    }
    super.dispose();
  }

  bool _isNetworkError(Object e) => e is DioException && e.response == null;

  Future<void> _handleContinue() async {
    setState(() => _error = '');
    if (_step == 'phone') {
      if (_phone.text.isEmpty) {
        setState(() => _error = 'Please enter your phone number');
        return;
      }
      setState(() => _step = 'auth');
      return;
    }
    if (_password.text.isEmpty) {
      setState(() => _error = 'Please enter password');
      return;
    }
    setState(() => _loading = true);
    try {
      final api = await widget.api();
      await api.postJson('/api/auth/login', {'phone': _phone.text, 'password': _password.text});
      await widget.onSignedIn();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message.isEmpty ? 'Login failed' : e.message);
    } catch (e) {
      if (mounted) {
        setState(() => _error = _isNetworkError(e) ? "You're offline. Please check your connection and try again." : 'Login failed');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleForgotRequest() async {
    setState(() {
      _error = '';
      _info = '';
    });
    if (_phone.text.isEmpty || _resetEmail.text.isEmpty) {
      setState(() => _error = 'Enter the login phone number and the email on the account');
      return;
    }
    setState(() => _loading = true);
    try {
      final api = await widget.api();
      final data = await api.postJson('/api/auth/forgot-password', {'phone': _phone.text, 'email': _resetEmail.text});
      var msg = data['message']?.toString() ?? '';
      final wa = data['debugWhatsAppOtp'];
      final em = data['debugEmailOtp'];
      if (wa != null || em != null) {
        msg += ' (staging WhatsApp ${wa ?? '—'}, email ${em ?? '—'})';
      }
      setState(() {
        _info = msg;
        _mode = _Mode.forgotVerify;
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message.isEmpty ? 'Could not send codes' : e.message);
    } catch (_) {
      setState(() => _error = 'Could not send codes');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _handleForgotVerify() async {
    setState(() {
      _error = '';
      _info = '';
    });
    if (_newPassword.text != _confirmPassword.text) {
      setState(() => _error = 'Passwords do not match');
      return;
    }
    setState(() => _loading = true);
    try {
      final api = await widget.api();
      final data = await api.postJson('/api/auth/reset-password', {
        'phone': _phone.text,
        'email': _resetEmail.text,
        'whatsappCode': _whatsappCode.text,
        'emailCode': _emailCode.text,
        'newPassword': _newPassword.text,
      });
      setState(() {
        _info = data['message']?.toString() ?? 'Password updated. Sign in with your new password.';
        _mode = _Mode.login;
        _step = 'auth';
        _password.clear();
        _whatsappCode.clear();
        _emailCode.clear();
        _newPassword.clear();
        _confirmPassword.clear();
      });
    } on ApiException catch (e) {
      setState(() => _error = e.message.isEmpty ? 'Could not reset password' : e.message);
    } catch (_) {
      setState(() => _error = 'Could not reset password');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Widget> _spaced(List<Widget> children, {double gap = AppSpace.lg}) {
    final out = <Widget>[];
    for (final child in children) {
      if (out.isNotEmpty) out.add(SizedBox(height: gap));
      out.add(child);
    }
    return out;
  }

  List<Widget> _banners() => [
    if (_info.isNotEmpty) _Notice(message: _info, tone: KTone.positive),
    if (_error.isNotEmpty) _Notice(message: _error, tone: KTone.negative),
  ];

  void _openForgot() => setState(() {
    _error = '';
    _info = '';
    _mode = _Mode.forgotRequest;
  });

  void _backToLogin() => setState(() {
    _mode = _Mode.login;
    _error = '';
    _info = '';
  });

  String get _title => switch (_mode) {
    _Mode.login => 'Sign in to your business',
    _ => 'Reset your password',
  };

  String get _subtitle => switch (_mode) {
    _Mode.login when _step == 'phone' => 'Enter the phone number you use for Khatario.',
    _Mode.login => 'Enter your password to continue.',
    _Mode.forgotRequest => 'We send one code on WhatsApp and one by email.',
    _Mode.forgotVerify => 'Enter both codes and choose a new password.',
  };

  List<Widget> _loginForm() => _spaced([
    ..._banners(),
    if (_step == 'phone')
      _BigField(
        key: const ValueKey('login-phone'),
        label: 'Phone Number',
        hint: 'Enter your phone number',
        icon: LucideIcons.smartphone,
        controller: _phone,
        keyboardType: TextInputType.phone,
        digitsMax: 15,
        onSubmitted: (_) => _handleContinue(),
      ),
    if (_step == 'auth') ...[
      _PhoneChip(phone: _phone.text, onChange: () => setState(() => _step = 'phone')),
      _BigField(
        key: const ValueKey('login-password'),
        label: 'Password',
        hint: 'Enter your password',
        icon: LucideIcons.lockKeyhole,
        controller: _password,
        keyboardType: TextInputType.visiblePassword,
        password: true,
        autofocus: true,
        onSubmitted: (_) => _handleContinue(),
      ),
    ],
    KButton(
      label: _step == 'phone' ? 'Continue' : 'Login',
      icon: _step == 'phone' ? null : LucideIcons.logIn,
      loading: _loading,
      height: 54,
      onPressed: _handleContinue,
    ),
    Center(
      child: KTextButton(label: 'Forgot password?', onTap: _openForgot),
    ),
  ]);

  List<Widget> _forgotRequestForm() => _spaced([
    ..._banners(),
    WebInput(
      key: const ValueKey('forgot-phone'),
      label: 'Login phone number',
      placeholder: 'Phone you use to sign in',
      controller: _phone,
      keyboardType: TextInputType.phone,
    ),
    WebInput(
      key: const ValueKey('forgot-email'),
      label: 'Account email',
      placeholder: 'Email on this business account',
      controller: _resetEmail,
      keyboardType: TextInputType.emailAddress,
    ),
    Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 1),
          child: Icon(LucideIcons.shieldCheck, size: 16, color: AppColors.ink2),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'We send two different codes: one on WhatsApp to this phone, one to this email. Both are required.',
            style: AppText.caption.copyWith(color: AppColors.ink2),
          ),
        ),
      ],
    ),
    KButton(label: 'Send WhatsApp and email codes', loading: _loading, height: 54, onPressed: _handleForgotRequest),
    Center(
      child: KTextButton(label: 'Back to sign in', onTap: _backToLogin),
    ),
  ]);

  List<Widget> _forgotVerifyForm() => _spaced([
    ..._banners(),
    WebInput(
      key: const ValueKey('forgot-whatsapp-code'),
      label: 'WhatsApp code',
      placeholder: '6-digit code from WhatsApp',
      controller: _whatsappCode,
      keyboardType: TextInputType.number,
      maxLength: 6,
      digitsOnly: true,
    ),
    WebInput(
      key: const ValueKey('forgot-email-code'),
      label: 'Email code',
      placeholder: '6-digit code from email',
      controller: _emailCode,
      keyboardType: TextInputType.number,
      maxLength: 6,
      digitsOnly: true,
    ),
    WebInput(
      key: const ValueKey('forgot-new-password'),
      label: 'New password',
      placeholder: 'At least 8 characters',
      controller: _newPassword,
      keyboardType: TextInputType.visiblePassword,
      obscureText: true,
    ),
    WebInput(
      key: const ValueKey('forgot-confirm-password'),
      label: 'Confirm new password',
      placeholder: 'Re-enter password',
      controller: _confirmPassword,
      keyboardType: TextInputType.visiblePassword,
      obscureText: true,
    ),
    KButton(label: 'Reset password', loading: _loading, height: 54, onPressed: _handleForgotVerify),
    Center(
      child: KTextButton(
        label: 'Resend codes',
        onTap: () => setState(() {
          _mode = _Mode.forgotRequest;
          _error = '';
        }),
      ),
    ),
  ]);

  @override
  Widget build(BuildContext context) {
    final keyboardOpen = MediaQuery.viewInsetsOf(context).bottom > 0;
    final showcase = _mode == _Mode.login && _step == 'phone' && !keyboardOpen;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light.copyWith(statusBarColor: Colors.transparent),
      child: Scaffold(
        backgroundColor: AppColors.surface,
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _LoginHero(showcase: showcase, onBack: _mode == _Mode.login ? null : _backToLogin),
            Expanded(
              child: Transform.translate(
                offset: const Offset(0, -28),
                child: Container(
                  decoration: const BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                  ),
                  child: SafeArea(
                    top: false,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          child: SingleChildScrollView(
                            padding: const EdgeInsets.fromLTRB(24, 28, 24, 16),
                            child: Center(
                              child: ConstrainedBox(
                                constraints: const BoxConstraints(maxWidth: 420),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    Text(_title, style: AppText.title.copyWith(fontSize: 26, height: 32 / 26)),
                                    const SizedBox(height: 6),
                                    Text(_subtitle, style: AppText.body.copyWith(color: AppColors.ink2)),
                                    const SizedBox(height: 24),
                                    ...switch (_mode) {
                                      _Mode.login => _loginForm(),
                                      _Mode.forgotRequest => _forgotRequestForm(),
                                      _Mode.forgotVerify => _forgotVerifyForm(),
                                    },
                                    const SizedBox(height: 36),
                                    Center(
                                      child: Wrap(
                                        crossAxisAlignment: WrapCrossAlignment.center,
                                        children: [
                                          Text("Don't have an account? ", style: AppText.label),
                                          KTextButton(
                                            label: 'Create a new account',
                                            onTap: () => launchUrl(Uri.parse('$apiBaseUrl/signup'), mode: LaunchMode.externalApplication),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Gradient top of the sign-in screen. On the first step it shows a short tour of what the app does.
class _LoginHero extends StatefulWidget {
  const _LoginHero({required this.showcase, this.onBack});

  final bool showcase;
  final VoidCallback? onBack;

  @override
  State<_LoginHero> createState() => _LoginHeroState();
}

class _LoginHeroState extends State<_LoginHero> {
  static const _slides = [
    (LucideIcons.receiptIndianRupee, 'GST bills in seconds', 'Create, print and share tax invoices right at the counter.'),
    (LucideIcons.messageCircle, 'Share on WhatsApp', 'Send bills and payment reminders to customers in one tap.'),
    (LucideIcons.chartNoAxesCombined, 'Stock and money, sorted', 'See what is running low and who owes you, every day.'),
  ];

  final _pages = PageController();
  Timer? _timer;
  int _page = 0;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted || !widget.showcase || !_pages.hasClients) return;
      _pages.animateToPage((_page + 1) % _slides.length, duration: const Duration(milliseconds: 450), curve: Curves.easeOutCubic);
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final on = AppGradients.on;
    final top = MediaQuery.paddingOf(context).top;
    final screen = MediaQuery.sizeOf(context).height;
    final showcaseHeight = (screen * 0.4).clamp(220.0, 340.0);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOutCubic,
      height: top + (widget.showcase ? showcaseHeight : 150),
      clipBehavior: Clip.hardEdge,
      decoration: BoxDecoration(gradient: AppGradients.hero),
      child: Stack(
        children: [
          Positioned(right: -70, top: -60, child: _HeroRing(size: 240, color: on.withValues(alpha: 0.07))),
          Positioned(left: -50, bottom: -10, child: _HeroRing(size: 150, color: on.withValues(alpha: 0.05))),
          Padding(
            padding: EdgeInsets.fromLTRB(20, top + 14, 20, 40),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (widget.onBack != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 4),
                        child: KIconButton(icon: LucideIcons.arrowLeft, tooltip: 'Back to sign in', color: on, onTap: widget.onBack!),
                      ),
                    Container(
                      width: 38,
                      height: 38,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: on.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: on.withValues(alpha: 0.24)),
                      ),
                      child: Text(
                        'K',
                        style: TextStyle(color: on, fontSize: 20, height: 1, fontWeight: FontWeight.w800),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'Khatario',
                      style: AppText.heading.copyWith(color: on, fontSize: 19, fontWeight: FontWeight.w700),
                    ),
                  ],
                ),
                if (widget.showcase) ...[
                  const SizedBox(height: 22),
                  Expanded(
                    child: PageView.builder(
                      controller: _pages,
                      itemCount: _slides.length,
                      onPageChanged: (i) => setState(() => _page = i),
                      itemBuilder: (_, i) {
                        final (icon, title, body) = _slides[i];
                        return LayoutBuilder(
                          builder: (context, box) => Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              if (box.maxHeight >= 160) ...[
                                Container(
                                  width: 56,
                                  height: 56,
                                  decoration: BoxDecoration(
                                    color: on.withValues(alpha: 0.14),
                                    borderRadius: BorderRadius.circular(18),
                                    border: Border.all(color: on.withValues(alpha: 0.2)),
                                  ),
                                  child: Icon(icon, size: 26, color: on),
                                ),
                                const SizedBox(height: 18),
                              ],
                              Text(
                                title,
                                style: AppText.title.copyWith(color: on, fontSize: 28, height: 34 / 28),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                body,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.body.copyWith(color: on.withValues(alpha: 0.78)),
                              ),
                              const SizedBox(height: 14),
                            ],
                          ),
                        );
                      },
                    ),
                  ),
                  Row(
                    children: [
                      for (var i = 0; i < _slides.length; i++)
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 220),
                          margin: const EdgeInsets.only(right: 6),
                          width: i == _page ? 22 : 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: on.withValues(alpha: i == _page ? 0.95 : 0.35),
                            borderRadius: BorderRadius.circular(6),
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _HeroRing extends StatelessWidget {
  const _HeroRing({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      border: Border.all(color: color, width: 22),
    ),
  );
}

/// Tall white field with a leading icon. Password fields get a show / hide eye.
class _BigField extends StatefulWidget {
  const _BigField({
    super.key,
    required this.label,
    required this.hint,
    required this.icon,
    required this.controller,
    this.keyboardType,
    this.password = false,
    this.autofocus = false,
    this.digitsMax,
    this.onSubmitted,
  });

  final String label;
  final String hint;
  final IconData icon;
  final TextEditingController controller;
  final TextInputType? keyboardType;
  final bool password;
  final bool autofocus;

  /// Digits only, at most this many.
  final int? digitsMax;
  final ValueChanged<String>? onSubmitted;

  @override
  State<_BigField> createState() => _BigFieldState();
}

class _BigFieldState extends State<_BigField> {
  late bool _hidden = widget.password;
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _focus.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final focused = _focus.hasFocus;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(widget.label, style: AppText.label),
        const SizedBox(height: 8),
        AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          height: 58,
          padding: const EdgeInsets.only(left: 16, right: 6),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.md),
            border: Border.all(color: focused ? AppColors.brand : AppColors.hairline, width: focused ? 2 : 1.5),
            boxShadow: focused ? [BoxShadow(color: AppColors.brand.withValues(alpha: 0.10), blurRadius: 0, spreadRadius: 4)] : null,
          ),
          child: Row(
            children: [
              Icon(widget.icon, size: 20, color: focused ? AppColors.brand : AppColors.ink3),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: widget.controller,
                  focusNode: _focus,
                  keyboardType: widget.keyboardType,
                  obscureText: _hidden,
                  autofocus: widget.autofocus,
                  onSubmitted: widget.onSubmitted,
                  textInputAction: TextInputAction.go,
                  inputFormatters: widget.digitsMax == null
                      ? null
                      : [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(widget.digitsMax)],
                  style: AppText.body.copyWith(
                    fontSize: 18,
                    fontWeight: FontWeight.w500,
                    letterSpacing: widget.digitsMax != null ? 0.8 : 0,
                  ),
                  cursorColor: AppColors.brand,
                  decoration: InputDecoration(
                    hintText: widget.hint,
                    hintStyle: AppText.body.copyWith(fontSize: 16, color: AppColors.ink3),
                    filled: false,
                    isDense: true,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    contentPadding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                ),
              ),
              if (widget.password)
                KIconButton(
                  icon: _hidden ? LucideIcons.eye : LucideIcons.eyeOff,
                  tooltip: _hidden ? 'Show password' : 'Hide password',
                  color: AppColors.ink2,
                  onTap: () => setState(() => _hidden = !_hidden),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// The number being signed in with, and a way back to change it.
class _PhoneChip extends StatelessWidget {
  const _PhoneChip({required this.phone, required this.onChange});

  final String phone;
  final VoidCallback onChange;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(6, 6, 14, 6),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(999), boxShadow: AppShadow.card),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: AppColors.brandSoft, shape: BoxShape.circle),
            child: Icon(LucideIcons.smartphone, size: 17, color: AppColors.brand),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(phone, style: AppText.bodyStrong.copyWith(letterSpacing: 0.6, fontFeatures: AppText.tabular)),
          ),
          KTextButton(label: 'Change Number', onTap: onChange),
        ],
      ),
    );
  }
}

/// Inline success / error message under the title.
class _Notice extends StatelessWidget {
  const _Notice({required this.message, required this.tone});

  final String message;
  final KTone tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(AppRadius.md)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(tone == KTone.negative ? LucideIcons.circleAlert : LucideIcons.circleCheck, size: 18, color: tone.fg),
          const SizedBox(width: 10),
          Expanded(
            child: Text(message, style: AppText.label.copyWith(color: tone.fg)),
          ),
        ],
      ),
    );
  }
}
