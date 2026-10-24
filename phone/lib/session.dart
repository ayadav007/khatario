import 'package:flutter/widgets.dart';

import 'api.dart';

/// Response of GET /api/auth/session.
class AppSession {
  AppSession(this.api, this.raw);

  final KhatarioApi api;
  final Map<String, dynamic> raw;

  Map<String, dynamic> get user => _map(raw['user']);
  Map<String, dynamic> get business => _map(raw['business']);
  bool get isPrimaryAdmin => raw['isPrimaryAdmin'] == true;

  String get userName => user['name']?.toString() ?? '';
  String get businessName => business['name']?.toString() ?? '';
  String? get businessId => business['id']?.toString();
  String? get businessLogoUrl {
    final url = business['logo_url']?.toString();
    return url == null || url.isEmpty ? null : url;
  }

  /// `<img src={logo_url}>`: logos can be `data:` URIs or paths on the Khatario host.
  late final ImageProvider? businessLogo = _logo();

  ImageProvider? _logo() {
    final url = businessLogoUrl;
    if (url == null) return null;
    if (url.startsWith('data:')) {
      final data = Uri.tryParse(url)?.data;
      return data == null ? null : MemoryImage(data.contentAsBytes());
    }
    return NetworkImage(Uri.parse(apiBaseUrl).resolve(url).toString());
  }

  /// `platformSession.enabledModules` (billing, connect, hr).
  List<String> get enabledModules {
    final list = _map(raw['platform'])['enabledModules'];
    return list is List ? list.map((e) => e.toString()).toList() : const [];
  }

  bool hasModule(String id) => enabledModules.contains(id);

  /// `isConnectAgentSeat`: `user.seat_type === 'connect'`.
  bool get isConnectAgent => user['seat_type'] == 'connect';

  /// `hasCapability(module, 'view')` for role-permission modules: the account owner, or the role's view flag.
  bool canView(String module) {
    if (isPrimaryAdmin) return true;
    final perms = _map(_map(raw['permissions'])[module]);
    return perms['can_view'] == true || perms['can_read'] == true;
  }

  /// `canModify(module) || isPrimaryAdmin` from `usePermissions` (`can_modify`).
  bool canModify(String module) {
    if (isPrimaryAdmin) return true;
    final perms = _map(_map(raw['permissions'])[module]);
    return perms['can_modify'] == true || perms['can_update'] == true;
  }

  /// `canDelete(module) || isPrimaryAdmin` from `usePermissions`.
  bool canDelete(String module) {
    if (isPrimaryAdmin) return true;
    return _map(_map(raw['permissions'])[module])['can_delete'] == true;
  }

  /// `BranchContext` default with no stored choice: the only branch; admins with several see all
  /// (null); other users get their first branch.
  String? get defaultBranchId {
    final list = raw['branches'];
    final branches = list is List ? list.whereType<Map>().where((b) => b['is_active'] != false).toList() : const <Map>[];
    if (branches.isEmpty) return null;
    final admin = isPrimaryAdmin;
    if (branches.length == 1 || !admin) return branches.first['id']?.toString();
    return null;
  }

  static Map<String, dynamic> _map(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};
}
