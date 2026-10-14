import 'package:flutter/material.dart';

/// Default Khatario theme from the website (`app/globals.css`).
class KhatarioColors {
  static const background = Color(0xFFF7F4EE);
  static const surface = Color(0xFFFFFFFF);
  static const ink = Color(0xFF063F35);
  static const inkSecondary = Color(0xFF3D5C56);
  static const muted = Color(0xFF6D8580);
  static const line = Color(0xFFE4DDD0);
  static const green = Color(0xFF063F35);
  static const greenSoft = Color(0xFFEEF2F1);
  static const orange = Color(0xFFF58220);
  static const due = Color(0xFFB45309);
  static const paidBg = Color(0xFFD1FAE5);
  static const paidFg = Color(0xFF065F46);
  static const dueBg = Color(0xFFFEF3C7);
  static const dueFg = Color(0xFF92400E);

  // `--color-primary-*` / `--color-accent-*`: follow the business portal theme (`lib/portal-theme.ts`).
  static final themeNotifier = ValueNotifier<PortalTheme>(PortalTheme.defaults);
  static PortalTheme get _theme => themeNotifier.value;
  static PortalTheme get theme => _theme;
  static void applyPortalTheme(Object? json) {
    final next = PortalTheme.fromJson(json);
    if (next.signature != _theme.signature) themeNotifier.value = next;
  }

  static Color get primary50 => _theme.primary[0];
  static Color get primary100 => _theme.primary[1];
  static Color get primary200 => _theme.primary[2];
  static Color get primary300 => _theme.primary[3];
  static Color get primary400 => _theme.primary[4];
  static Color get primary500 => _theme.primary[5];
  static Color get primary600 => _theme.primary[6];
  static Color get primary700 => _theme.primary[7];
  static Color get primary800 => _theme.primary[8];
  static Color get primary900 => _theme.primary[9];
  static Color get accent50 => _theme.accent[0];
  static Color get accent100 => _theme.accent[1];
  static Color get accent500 => _theme.accent[5];
  static Color get accent600 => _theme.accent[6];
  static Color get accent700 => _theme.accent[7];

  /// `--portal-font-sans`; null is the platform UI font ("system" preset).
  static String? get fontFamily => _theme.fontFamily;
}

/// `PortalTheme` from `lib/portal-theme.ts`, expanded to 50..900 scales.
class PortalTheme {
  PortalTheme._(this.primaryHex, this.accentHex, this.fontPreset)
      : primary = _scale(primaryHex),
        accent = _scale(accentHex);

  static const fontPresets = ['inter', 'system', 'dm_sans', 'source_sans'];
  static final defaults = PortalTheme._('#063f35', '#f58220', 'inter');

  final String primaryHex;
  final String accentHex;
  final String fontPreset;
  final List<Color> primary;
  final List<Color> accent;

  String get signature => '$primaryHex|$accentHex|$fontPreset';

  String? get fontFamily => switch (fontPreset) {
        'system' => null,
        'dm_sans' => 'DMSans',
        'source_sans' => 'SourceSans3',
        _ => 'Inter',
      };

  /// `normalizePortalThemeJson` + `mergePortalTheme`.
  factory PortalTheme.fromJson(Object? raw) {
    if (raw is! Map) return defaults;
    final primary = parseHex(raw['primary_hex']);
    if (primary == null) return defaults;
    final presetRaw = raw['font_preset'] is String ? (raw['font_preset'] as String).trim() : '';
    final preset = fontPresets.contains(presetRaw) ? presetRaw : 'inter';
    return PortalTheme._(primary, parseHex(raw['accent_hex']) ?? defaults.accentHex, preset);
  }

  /// `parseHexColorInput`: #RGB or #RRGGBB, returns lowercase #rrggbb.
  static String? parseHex(Object? raw) {
    if (raw is! String) return null;
    final s = raw.trim();
    if (s.isEmpty) return null;
    var body = s.startsWith('#') ? s.substring(1) : s;
    if (RegExp(r'^[0-9a-fA-F]{3}$').hasMatch(body)) {
      body = body.split('').map((c) => '$c$c').join();
    }
    if (!RegExp(r'^[0-9a-fA-F]{6}$').hasMatch(body)) return null;
    return '#${body.toLowerCase()}';
  }

  /// `brandHexToCssVars`: mix toward white for 50..400, black for 600..900.
  static List<Color> _scale(String hex) {
    final n = int.parse(hex.substring(1), radix: 16);
    final r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const steps = [0.93, 0.85, 0.68, 0.48, 0.26, 0.0, -0.14, -0.28, -0.42, -0.55];
    int ch(int base, double t) {
      final target = t < 0 ? 0 : 255;
      final v = base + (target - base) * t.abs();
      return v.round().clamp(0, 255);
    }

    return [for (final t in steps) Color.fromARGB(255, ch(r, t), ch(g, t), ch(b, t))];
  }
}

/// Tailwind palette values used by the website.
class Tw {
  static const slate50 = Color(0xFFF8FAFC);
  static const slate100 = Color(0xFFF1F5F9);
  static const slate300 = Color(0xFFCBD5E1);
  static const emerald500 = Color(0xFF10B981);
  static const orange500 = Color(0xFFF97316);
  static const rose50 = Color(0xFFFFF1F2);
  static const rose100 = Color(0xFFFFE4E6);
  static const rose600 = Color(0xFFE11D48);
  static const slate700 = Color(0xFF334155);
  static const slate900 = Color(0xFF0F172A);
  static const gray50 = Color(0xFFF9FAFB);
  static const gray100 = Color(0xFFF3F4F6);
  static const gray200 = Color(0xFFE5E7EB);
  static const gray400 = Color(0xFF9CA3AF);
  static const gray500 = Color(0xFF6B7280);
  static const gray600 = Color(0xFF4B5563);
  static const gray700 = Color(0xFF374151);
  static const gray800 = Color(0xFF1F2937);
  static const gray900 = Color(0xFF111827);
  static const red50 = Color(0xFFFEF2F2);
  static const red100 = Color(0xFFFEE2E2);
  static const red200 = Color(0xFFFECACA);
  static const red500 = Color(0xFFEF4444);
  static const red600 = Color(0xFFDC2626);
  static const red700 = Color(0xFFB91C1C);
  static const green100 = Color(0xFFDCFCE7);
  static const green200 = Color(0xFFBBF7D0);
  static const green300 = Color(0xFF86EFAC);
  static const green500 = Color(0xFF22C55E);
  static const green600 = Color(0xFF16A34A);
  static const green700 = Color(0xFF15803D);
  static const green800 = Color(0xFF166534);
  static const emerald50 = Color(0xFFECFDF5);
  static const emerald200 = Color(0xFFA7F3D0);
  static const emerald700 = Color(0xFF047857);
  static const emerald800 = Color(0xFF065F46);
  static const emerald900 = Color(0xFF064E3B);
  static const teal50 = Color(0xFFF0FDFA);
  static const green50 = Color(0xFFF0FDF4);
  static const amber50 = Color(0xFFFFFBEB);
  static const amber100 = Color(0xFFFEF3C7);
  static const amber200 = Color(0xFFFDE68A);
  static const amber500 = Color(0xFFF59E0B);
  static const amber600 = Color(0xFFD97706);
  static const amber700 = Color(0xFFB45309);
  static const amber800 = Color(0xFF92400E);
  static const orange50 = Color(0xFFFFF7ED);
  static const orange100 = Color(0xFFFFEDD5);
  static const orange200 = Color(0xFFFED7AA);
  static const orange600 = Color(0xFFEA580C);
  static const orange700 = Color(0xFFC2410C);
  static const yellow50 = Color(0xFFFEFCE8);
  static const yellow200 = Color(0xFFFEF08A);
  static const yellow300 = Color(0xFFFDE047);
  static const yellow700 = Color(0xFFA16207);
  static const yellow800 = Color(0xFF854D0E);
  static const orange300 = Color(0xFFFDBA74);
  static const orange400 = Color(0xFFFB923C);
  static const orange800 = Color(0xFF9A3412);
  static const orange900 = Color(0xFF7C2D12);
  static const red300 = Color(0xFFFCA5A5);
  static const red800 = Color(0xFF991B1B);
  static const red900 = Color(0xFF7F1D1D);
  static const blue50 = Color(0xFFEFF6FF);
  static const blue200 = Color(0xFFBFDBFE);
  static const blue300 = Color(0xFF93C5FD);
  static const blue800 = Color(0xFF1E40AF);
  static const amber900 = Color(0xFF78350F);
  static const gray300 = Color(0xFFD1D5DB);
}

/// Phone design tokens. New and redesigned screens use these instead of `Tw.*` or inline values.
///
/// Only [AppColors.brand] and its tints follow the business portal theme. Neutrals and money
/// states stay fixed so paid / due / overdue read the same in every theme.
class AppColors {
  static const bg = Color(0xFFF2F0EB);
  static const surface = Color(0xFFFFFFFF);

  /// Search fields, chips, segmented controls, secondary buttons.
  static const sunken = Color(0xFFEDEAE3);

  /// Row separators inside a card.
  static const hairline = Color(0xFFECE7DD);

  static const ink = Color(0xFF13221E);
  static const ink2 = Color(0xFF5A6863);
  static const ink3 = Color(0xFF8E9893);

  static Color get brand => KhatarioColors.primary500;
  static Color get brandSoft => KhatarioColors.primary50;
  static Color get brandStrong => KhatarioColors.primary700;

  /// Text and icons on [brand]. Light brand colours get dark text.
  static Color get onBrand => brand.computeLuminance() > 0.45 ? ink : Colors.white;

  static const positive = Color(0xFF15803D);
  static const positiveSoft = Color(0xFFE5F3E9);
  static const due = Color(0xFFB45309);
  static const dueSoft = Color(0xFFFBEFD9);
  static const warning = Color(0xFFE0A030);
  static const negative = Color(0xFFC62828);
  static const negativeSoft = Color(0xFFFBE8E8);

  static const scrim = Color(0x6613221E);
}

/// 4px spacing grid. [gutter] is the screen edge padding.
class AppSpace {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 24.0;
  static const xxl = 32.0;
  static const gutter = 16.0;
}

class AppRadius {
  /// Chips, inputs, small buttons.
  static const sm = 10.0;

  /// Buttons and search fields.
  static const md = 14.0;

  /// Cards.
  static const lg = 16.0;

  /// Bottom sheets.
  static const sheet = 24.0;
}

class AppShadow {
  static const card = [
    BoxShadow(color: Color(0x0F13221E), blurRadius: 3, offset: Offset(0, 1)),
    BoxShadow(color: Color(0x1213221E), blurRadius: 28, offset: Offset(0, 10), spreadRadius: -6),
  ];

  /// Cards that sit on the brand band.
  static const raised = [
    BoxShadow(color: Color(0x1A13221E), blurRadius: 4, offset: Offset(0, 2)),
    BoxShadow(color: Color(0x2413221E), blurRadius: 40, offset: Offset(0, 18), spreadRadius: -10),
  ];

  static List<BoxShadow> get fab => [
        BoxShadow(color: AppColors.brand.withValues(alpha: 0.28), blurRadius: 24, offset: const Offset(0, 10)),
      ];
}

/// Brand gradients. Horizontal so the app bar and the Home band join without a seam.
class AppGradients {
  static LinearGradient get brand => LinearGradient(
        begin: Alignment.centerLeft,
        end: Alignment.centerRight,
        colors: [KhatarioColors.primary800, KhatarioColors.primary600, KhatarioColors.primary500],
      );

  /// Login hero.
  static LinearGradient get hero => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [KhatarioColors.primary900, KhatarioColors.primary700, KhatarioColors.primary500],
      );

  /// Text and icons on the gradients.
  static Color get on => KhatarioColors.primary600.computeLuminance() > 0.45 ? AppColors.ink : Colors.white;
}

/// Fixed soft colour pairs (background, foreground) for icon tiles, so actions are easy to tell apart.
class AppTints {
  static const green = (Color(0xFFE2F4E8), Color(0xFF15803D));
  static const violet = (Color(0xFFEDE8FD), Color(0xFF6D28D9));
  static const amber = (Color(0xFFFCEFD6), Color(0xFFB45309));
  static const sky = (Color(0xFFE0F0FC), Color(0xFF0369A1));
  static const rose = (Color(0xFFFCE6EB), Color(0xFFBE123C));
  static const teal = (Color(0xFFDCF3EF), Color(0xFF0F766E));
  static const indigo = (Color(0xFFE5E8FB), Color(0xFF4338CA));
  static const orange = (Color(0xFFFDE9DA), Color(0xFFC2410C));
}

/// Type scale. Money uses [tabular] so columns of amounts line up.
class AppText {
  static String? get _font => KhatarioColors.fontFamily;
  static const tabular = [FontFeature.tabularFigures()];

  /// Hero amounts (`₹48,260`).
  static TextStyle get display => TextStyle(
      fontFamily: _font, fontSize: 40, height: 44 / 40, fontWeight: FontWeight.w700, letterSpacing: -1.4, color: AppColors.ink, fontFeatures: tabular);

  /// Large page titles.
  static TextStyle get title =>
      TextStyle(fontFamily: _font, fontSize: 26, height: 32 / 26, fontWeight: FontWeight.w700, letterSpacing: -0.65, color: AppColors.ink);

  /// Secondary amounts in cards.
  static TextStyle get amount => TextStyle(
      fontFamily: _font, fontSize: 24, height: 30 / 24, fontWeight: FontWeight.w700, letterSpacing: -0.5, color: AppColors.ink, fontFeatures: tabular);

  /// Section headings and app bar titles.
  static TextStyle get heading =>
      TextStyle(fontFamily: _font, fontSize: 17, height: 22 / 17, fontWeight: FontWeight.w600, letterSpacing: -0.15, color: AppColors.ink);

  static TextStyle get bodyStrong => TextStyle(fontFamily: _font, fontSize: 15, height: 21 / 15, fontWeight: FontWeight.w600, color: AppColors.ink);
  static TextStyle get body => TextStyle(fontFamily: _font, fontSize: 15, height: 21 / 15, fontWeight: FontWeight.w400, color: AppColors.ink);
  static TextStyle get label => TextStyle(fontFamily: _font, fontSize: 13, height: 18 / 13, fontWeight: FontWeight.w500, color: AppColors.ink2);
  static TextStyle get caption => TextStyle(fontFamily: _font, fontSize: 13, height: 18 / 13, fontWeight: FontWeight.w400, color: AppColors.ink3);
  static TextStyle get small => TextStyle(fontFamily: _font, fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w600, color: AppColors.ink2);

  /// Uppercase group headers in lists (`TODAY`).
  static TextStyle get overline =>
      TextStyle(fontFamily: _font, fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w600, letterSpacing: 0.7, color: AppColors.ink3);
}

ThemeData khatarioTheme() {
  final font = KhatarioColors.fontFamily;
  final text = TextStyle(fontFamily: font, color: KhatarioColors.ink);
  return ThemeData(
    useMaterial3: true,
    fontFamily: font,
    scaffoldBackgroundColor: AppColors.bg,
    colorScheme: ColorScheme.light(
      primary: KhatarioColors.primary500,
      onPrimary: AppColors.onBrand,
      secondary: KhatarioColors.accent500,
      onSecondary: Colors.white,
      surface: KhatarioColors.surface,
      onSurface: KhatarioColors.ink,
      error: const Color(0xFFEF4444),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      modalBarrierColor: AppColors.scrim,
      showDragHandle: false,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.sheet))),
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: AppColors.ink,
      contentTextStyle: TextStyle(fontFamily: font, fontSize: 14, color: Colors.white),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
    ),
    textTheme: TextTheme(
      bodyMedium: text,
      bodyLarge: text,
      titleLarge: TextStyle(
        fontFamily: font,
        fontWeight: FontWeight.w700,
        fontSize: 22,
        letterSpacing: -0.3,
        color: KhatarioColors.ink,
      ),
    ),
    dividerColor: KhatarioColors.line,
    splashFactory: NoSplash.splashFactory,
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: KhatarioColors.surface,
      hintStyle: TextStyle(color: KhatarioColors.muted, fontFamily: font, fontSize: 16),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      enabledBorder: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(8)),
        borderSide: BorderSide(color: KhatarioColors.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: const BorderRadius.all(Radius.circular(8)),
        borderSide: BorderSide(color: KhatarioColors.primary500),
      ),
      border: const OutlineInputBorder(
        borderRadius: BorderRadius.all(Radius.circular(8)),
      ),
    ),
  );
}

String inr(int amount) {
  final negative = amount < 0;
  final digits = amount.abs().toString();
  if (digits.length <= 3) {
    return '${negative ? '-' : ''}₹$digits';
  }
  final tail = digits.substring(digits.length - 3);
  var head = digits.substring(0, digits.length - 3);
  final parts = <String>[];
  while (head.length > 2) {
    parts.insert(0, head.substring(head.length - 2));
    head = head.substring(0, head.length - 2);
  }
  if (head.isNotEmpty) parts.insert(0, head);
  return '${negative ? '-' : ''}₹${parts.join(',')},$tail';
}
