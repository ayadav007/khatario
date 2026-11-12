import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:printing/printing.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../api.dart';
import '../../session.dart';
import '../../theme.dart';
import '../../ui/kit.dart';
import 'website_page_logic.dart';
import 'website_print_bridge.dart';

/// Marks the phone app to the website, which then hides its own sidebar, top bar and bottom bar.
const phoneUserAgentMark = 'KhatarioPhone';

/// The website address for a menu link, on the same server the app talks to.
Uri websiteUri(String href) => Uri.parse(apiBaseUrl).resolve(href.startsWith('/') ? href : '/$href');

/// A website page shown inside the app, already signed in, for anything without a phone screen.
class WebsitePageScreen extends StatefulWidget {
  const WebsitePageScreen({super.key, required this.session, required this.href, required this.title});

  final AppSession session;
  final String href;
  final String title;

  @override
  State<WebsitePageScreen> createState() => _WebsitePageScreenState();
}

class _WebsitePageScreenState extends State<WebsitePageScreen> {
  WebViewController? _controller;
  final _status = WebPageStatus();

  @override
  void initState() {
    super.initState();
    _open();
  }

  /// Hands the app's sign-in cookies to the web view, so the page opens signed in.
  Future<void> _copySessionCookies(Uri uri) async {
    final jar = widget.session.api.cookies;
    if (jar == null) return;
    final cookies = await jar.loadForRequest(uri);
    final manager = WebViewCookieManager();
    for (final c in cookies) {
      await manager.setCookie(WebViewCookie(name: c.name, value: c.value, domain: c.domain ?? uri.host, path: c.path ?? '/'));
    }
  }

  Future<void> _open() async {
    _status.retry();
    final uri = websiteUri(widget.href);
    try {
      await _copySessionCookies(uri);
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(AppColors.bg);
      final agent = await controller.getUserAgent();
      await controller.setUserAgent('${agent ?? ''} $phoneUserAgentMark'.trim());
      // The web view cannot print; the website's print buttons are handed to the phone instead.
      await controller.addJavaScriptChannel(printChannelName, onMessageReceived: (m) => _onPrintMessage(m.message));
      await controller.setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) => _status.started(),
        onProgress: _status.progress,
        onPageFinished: (_) {
          controller.runJavaScript(websitePrintBridgeScript).catchError((_) {});
          _status.finished();
        },
        onWebResourceError: (error) => _status.mainFrameError(isMainFrame: error.isForMainFrame),
      ));
      await controller.loadRequest(uri);
      if (mounted) setState(() => _controller = controller);
    } catch (_) {
      _status.mainFrameError(isMainFrame: true);
    }
  }

  @override
  void dispose() {
    _status.dispose();
    super.dispose();
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _onPrintMessage(String message) async {
    final request = WebsitePrintRequest.parse(message);
    try {
      switch (request) {
        case PrintHtml():
          await printWebsiteHtml(request, baseUrl: Uri.parse(apiBaseUrl).origin);
        case OpenUrl(:final url):
          await _openFromPage(url);
        case null:
          return;
      }
    } catch (_) {
      if (mounted) _toast('Could not print this page. Try again.');
    }
  }

  /// A page the website tried to open in a new window: a PDF prints; another page opens here.
  Future<void> _openFromPage(String url) async {
    final target = Uri.tryParse(url);
    final base = Uri.parse(apiBaseUrl);
    if (target == null || target.host != base.host) {
      if (mounted) _toast('This link opens outside Khatario.');
      return;
    }
    final path = target.hasQuery ? '${target.path}?${target.query}' : target.path;
    if (target.path.endsWith('/pdf') || target.path.endsWith('.pdf')) {
      final bytes = await widget.session.api.getBytes(path);
      await Printing.layoutPdf(name: widget.title, onLayout: (_) async => Uint8List.fromList(bytes));
      return;
    }
    if (mounted) openWebsiteInApp(context, widget.session, path, widget.title);
  }

  /// Back walks the page's history; with none left it closes the screen.
  bool _backBusy = false;

  Future<void> _onBack() async {
    if (_backBusy) return;
    _backBusy = true;
    final controller = _controller;
    try {
      final action = controller == null ? WebBack.leaveScreen : await _status.back(_ControllerHistory(controller));
      // After leaving, the guard stays on, so a second fast press cannot pop twice.
      if (action == WebBack.leaveScreen && mounted) {
        Navigator.of(context).pop();
        return;
      }
    } catch (_) {}
    _backBusy = false;
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _onBack();
      },
      child: Scaffold(
        backgroundColor: AppColors.bg,
        body: SafeArea(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              KBackBar(
                widget.title,
                trailing: KIconButton(icon: LucideIcons.refreshCw, tooltip: 'Reload', onTap: _open),
              ),
              ListenableBuilder(
                listenable: _status,
                builder: (context, _) => _status.showBar
                    ? LinearProgressIndicator(minHeight: 2, value: _status.barValue, color: AppColors.brand, backgroundColor: AppColors.hairline)
                    : const SizedBox(height: 2),
              ),
              Expanded(
                child: controller == null
                    ? ListenableBuilder(
                        listenable: _status,
                        builder: (context, _) => _status.failed ? _offline() : const KSpinner(),
                      )
                    : Stack(
                        children: [
                          Positioned.fill(child: WebViewWidget(controller: controller)),
                          // Over the page, not instead of it, so Back can still return to it.
                          ListenableBuilder(
                            listenable: _status,
                            builder: (context, _) => _status.failed ? Positioned.fill(child: _offline()) : const SizedBox.shrink(),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _offline() => ColoredBox(
        color: AppColors.bg,
        child: ListView(children: [
          KEmptyState(
            icon: LucideIcons.cloudOff,
            title: 'Could not open this page',
            body: 'Check the internet connection and try again.',
            action: KButton(label: 'Try again', onPressed: _open, expand: false),
          ),
        ]),
      );
}

/// The platform web view's history, for [WebPageStatus.back].
class _ControllerHistory implements WebHistory {
  _ControllerHistory(this.controller);

  final WebViewController controller;

  @override
  Future<bool> canGoBack() => controller.canGoBack();

  @override
  Future<void> goBack() => controller.goBack();
}

/// Opens [href] inside the app on the website, signed in.
void openWebsiteInApp(BuildContext context, AppSession session, String href, String title) {
  Navigator.of(context).push(MaterialPageRoute(builder: (_) => WebsitePageScreen(session: session, href: href, title: title)));
}
