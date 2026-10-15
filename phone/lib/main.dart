import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'screens/login_screen.dart';
import 'session.dart';
import 'shell/app_shell.dart';
import 'theme.dart';

String signedOutNotice({required bool replaced}) {
  if (!replaced) return 'Signed out. Sign in again to continue.';
  return 'Signed out. This account was opened on another phone. '
      'To stay signed in on more than one phone, upgrade from the phone that is still signed in: '
      'Settings, then Plan & billing. You can do the same on the website in that login.';
}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: KhatarioColors.background,
      statusBarIconBrightness: Brightness.dark,
      systemNavigationBarColor: KhatarioColors.surface,
      systemNavigationBarIconBrightness: Brightness.dark,
    ),
  );
  runApp(const KhatarioApp());
}

class KhatarioApp extends StatelessWidget {
  const KhatarioApp({super.key, this.restoreSession = true});

  final bool restoreSession;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<PortalTheme>(
      valueListenable: KhatarioColors.themeNotifier,
      builder: (context, _, _) => MaterialApp(
        title: 'Khatario',
        debugShowCheckedModeBanner: false,
        theme: khatarioTheme(),
        home: AppRoot(restoreSession: restoreSession),
      ),
    );
  }
}

class AppRoot extends StatefulWidget {
  const AppRoot({super.key, required this.restoreSession});

  final bool restoreSession;

  @override
  State<AppRoot> createState() => _AppRootState();
}

class _AppRootState extends State<AppRoot> with WidgetsBindingObserver {
  KhatarioApi? _api;
  Map<String, dynamic>? _session;
  bool _checking = true;
  String? _signedOutNote;

  Future<KhatarioApi> _client() async => _api ??= await KhatarioApi.open();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.restoreSession) {
      _loadSession();
    } else {
      _checking = false;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _session != null) _loadSession();
  }

  void _watchSignedInSession(KhatarioApi api) {
    api.watchSession((error) {
      if (!mounted || _session == null) return;
      final replaced = error.code == 'SESSION_REVOKED';
      _signedOutNote = signedOutNotice(replaced: replaced);
      api.watchSession(null);
      api.clearCookies();
      KhatarioColors.applyPortalTheme(null);
      setState(() => _session = null);
    });
  }

  Future<void> _loadSession() async {
    try {
      final api = await _client();
      final session = await api.getJson('/api/auth/session');
      KhatarioColors.applyPortalTheme(session['portalTheme']);
      if (!mounted) return;
      _signedOutNote = null;
      _watchSignedInSession(api);
      setState(() => _session = session);
    } catch (e) {
      final ended = e is ApiException && sessionWasEnded(e.status, e.code, e.message);
      if (ended && mounted && _session != null && _signedOutNote == null) {
        _signedOutNote = signedOutNotice(replaced: e.code == 'SESSION_REVOKED');
        _api?.watchSession(null);
        _api?.clearCookies();
        KhatarioColors.applyPortalTheme(null);
        setState(() => _session = null);
      } else if (_session == null) {
        KhatarioColors.applyPortalTheme(null);
      }
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _signOut() async {
    _signedOutNote = null;
    _api?.watchSession(null);
    try {
      final api = await _client();
      await api.postJson('/api/auth/logout', const {});
    } catch (_) {}
    await _api?.clearCookies();
    KhatarioColors.applyPortalTheme(null);
    if (mounted) setState(() => _session = null);
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(
        backgroundColor: KhatarioColors.background,
        body: Center(child: CircularProgressIndicator(color: KhatarioColors.ink)),
      );
    }
    final session = _session;
    if (session == null) {
      return LoginScreen(api: _client, onSignedIn: _loadSession, notice: _signedOutNote);
    }
    final appSession = AppSession(_api!, session);
    return AppShell(
      key: ValueKey('${appSession.businessId}|${KhatarioColors.theme.signature}'),
      session: appSession,
      onSessionChanged: _loadSession,
      onSignOut: _signOut,
    );
  }
}
