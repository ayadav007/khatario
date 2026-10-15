import 'package:flutter/material.dart';

import '../theme.dart';
import 'device_bridge.dart';
import 'face/face_capture.dart';
import 'home_screen.dart';
import 'location_sampler.dart';
import 'pair_screen.dart';
import 'punch_flow.dart';
import 'staff_api.dart';

/// Khatario Staff: employee check-in only. Built from this codebase with `--flavor staff`.
class StaffApp extends StatefulWidget {
  const StaffApp({super.key, this.api, this.device, this.location, this.face});

  /// Injected by tests; the real app opens its own.
  final StaffApi? api;
  final StaffDeviceBridge? device;
  final LocationSampler? location;
  final FaceCapturer? face;

  @override
  State<StaffApp> createState() => _StaffAppState();
}

class _StaffAppState extends State<StaffApp> {
  final _navigator = GlobalKey<NavigatorState>();
  late final FaceCapturer _face = widget.face ?? CameraFaceCapturer(_navigator);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Khatario Staff',
      navigatorKey: _navigator,
      debugShowCheckedModeBanner: false,
      theme: khatarioTheme(),
      home: StaffRoot(api: widget.api, device: widget.device, location: widget.location, face: _face),
    );
  }
}

class StaffRoot extends StatefulWidget {
  const StaffRoot({super.key, this.api, this.device, this.location, this.face});

  final StaffApi? api;
  final StaffDeviceBridge? device;
  final LocationSampler? location;
  final FaceCapturer? face;

  @override
  State<StaffRoot> createState() => _StaffRootState();
}

class _StaffRootState extends State<StaffRoot> {
  StaffApi? _api;
  bool _linked = false;
  String? _notice;

  @override
  void initState() {
    super.initState();
    _open();
  }

  Future<void> _open() async {
    final api = widget.api ?? await StaffApi.open(device: widget.device);
    if (!mounted) return;
    setState(() {
      _api = api;
      _linked = api.link != null;
    });
  }

  Future<void> _unlinked(String message) async {
    await _api?.forget();
    if (mounted) {
      setState(() {
        _linked = false;
        _notice = message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = _api;
    if (api == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    if (!_linked) {
      return StaffPairScreen(
        api: api,
        notice: _notice,
        onLinked: (_) => setState(() {
          _linked = true;
          _notice = null;
        }),
      );
    }
    return StaffHomeScreen(
      api: api,
      flow: PunchFlow(api: api, device: api.device, location: widget.location ?? GeolocatorSampler(), face: widget.face),
      onUnlinked: _unlinked,
    );
  }
}
