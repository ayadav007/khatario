import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'staff/staff_app.dart';
import 'theme.dart';

/// Khatario Staff entry point:
///   flutter run --flavor staff -t lib/main_staff.dart
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
  runApp(const StaffApp());
}
