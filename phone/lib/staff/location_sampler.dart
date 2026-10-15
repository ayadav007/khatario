import 'package:geolocator/geolocator.dart';

enum LocationProblem { serviceOff, denied, deniedForever }

class LocationUnavailable implements Exception {
  LocationUnavailable(this.problem);
  final LocationProblem problem;

  String get message => switch (problem) {
        LocationProblem.serviceOff => 'Turn on location (GPS) to check in.',
        LocationProblem.denied => 'Allow location so Khatario Staff can check you in.',
        LocationProblem.deniedForever =>
          'Location is blocked for Khatario Staff. Allow it in the phone settings, then try again.',
      };

  @override
  String toString() => message;
}

/// Several fresh GPS readings a little apart. The server compares them: real GPS wobbles.
abstract class LocationSampler {
  /// Location on and allowed, or [LocationUnavailable]. Asks for permission if needed.
  Future<void> ensureReady();
  Future<List<Map<String, dynamic>>> sample({required int count, required Duration interval});
  Future<void> openSettings();
}

class GeolocatorSampler implements LocationSampler {
  @override
  Future<void> ensureReady() async {
    if (!await Geolocator.isLocationServiceEnabled()) throw LocationUnavailable(LocationProblem.serviceOff);
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.deniedForever) throw LocationUnavailable(LocationProblem.deniedForever);
    if (permission == LocationPermission.denied) throw LocationUnavailable(LocationProblem.denied);
  }

  @override
  Future<List<Map<String, dynamic>>> sample({required int count, required Duration interval}) async {
    final settings = AndroidSettings(accuracy: LocationAccuracy.best, timeLimit: const Duration(seconds: 15));
    final out = <Map<String, dynamic>>[];
    for (var i = 0; i < count; i++) {
      if (i > 0) await Future<void>.delayed(interval);
      try {
        out.add(positionJson(await Geolocator.getCurrentPosition(locationSettings: settings)));
      } catch (_) {
        // One slow fix is fine; the server needs at least three.
      }
    }
    return out;
  }

  @override
  Future<void> openSettings() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      await Geolocator.openLocationSettings();
    } else {
      await Geolocator.openAppSettings();
    }
  }
}

Map<String, dynamic> positionJson(Position p) => {
      'lat': p.latitude,
      'lng': p.longitude,
      'accuracy_m': p.accuracy,
      'altitude_m': p.hasAltitude ? p.altitude : null,
      'timestamp_ms': p.timestamp.millisecondsSinceEpoch,
      'is_mocked': p.isMocked,
    };
