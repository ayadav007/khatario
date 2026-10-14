import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'screens/login_screen.dart';
import 'session.dart';
import 'shell/app_shell.dart';
import 'theme.dart';

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

class _AppRootState extends State<AppRoot> {
  KhatarioApi? _api;
  Map<String, dynamic>? _session;
  bool _checking = true;

  Future<KhatarioApi> _client() async => _api ??= await KhatarioApi.open();

  @override
  void initState() {
    super.initState();
    if (widget.restoreSession) {
      _loadSession();
    } else {
      _checking = false;
    }
  }

  Future<void> _loadSession() async {
    try {
      final api = await _client();
      final session = await api.getJson('/api/auth/session');
      KhatarioColors.applyPortalTheme(session['portalTheme']);
      if (mounted) setState(() => _session = session);
    } catch (_) {
      KhatarioColors.applyPortalTheme(null);
      if (mounted) setState(() => _session = null);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  Future<void> _signOut() async {
    try {
      final api = await _client();
      await api.postJson('/api/auth/logout', const {});
    } catch (_) {}
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
      return LoginScreen(api: _client, onSignedIn: _loadSession);
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
