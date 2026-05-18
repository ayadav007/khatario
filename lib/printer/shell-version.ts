/**
 * Android Capacitor shell versioning.
 *
 * Bump APP_SHELL_VERSION_CODE / NAME when native permissions, plugins, or
 * WebView behaviour change and older APKs must be replaced.
 *
 * Keep in sync with android/app/build.gradle (versionCode / versionName)
 * and capacitor.config.ts → plugins.KhatarioShell.
 */

export const APP_SHELL_VERSION_CODE = 1;
export const APP_SHELL_VERSION_NAME = '1.0.0';

export type ShellVersionInfo = {
  versionCode: number;
  versionName: string;
};

/** Read version baked into the installed APK (Capacitor config in native assets). */
export function getEmbeddedNativeShellVersion(): ShellVersionInfo | null {
  if (typeof window === 'undefined') return null;
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.() || typeof cap.getConfig !== 'function') {
    return null;
  }
  try {
    const shell = cap.getConfig()?.plugins?.KhatarioShell as
      | { versionCode?: number; versionName?: string }
      | undefined;
    if (!shell?.versionCode) return null;
    return {
      versionCode: Number(shell.versionCode),
      versionName: String(shell.versionName ?? APP_SHELL_VERSION_NAME),
    };
  } catch {
    return null;
  }
}

export type ShellCompatibilityResult = {
  isNativeShell: boolean;
  embedded: ShellVersionInfo | null;
  minimumRequired: ShellVersionInfo;
  isCompatible: boolean;
  shouldWarn: boolean;
};

export function evaluateShellCompatibility(
  minimumCode: number,
  minimumName: string
): ShellCompatibilityResult {
  const embedded = getEmbeddedNativeShellVersion();
  const isNativeShell = embedded !== null;
  const minimumRequired = {
    versionCode: minimumCode,
    versionName: minimumName,
  };

  if (!isNativeShell || !embedded) {
    return {
      isNativeShell: false,
      embedded,
      minimumRequired,
      isCompatible: true,
      shouldWarn: false,
    };
  }

  const isCompatible = embedded.versionCode >= minimumCode;
  return {
    isNativeShell: true,
    embedded,
    minimumRequired,
    isCompatible,
    shouldWarn: !isCompatible,
  };
}
