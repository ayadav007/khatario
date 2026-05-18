import { NextResponse } from 'next/server';
import {
  APP_SHELL_VERSION_CODE,
  APP_SHELL_VERSION_NAME,
} from '@/lib/printer/shell-version';

export const dynamic = 'force-dynamic';

/**
 * Minimum Android shell (APK) version required for native features.
 * Bump when native plugins or permissions change; older APKs get a warning only.
 */
export async function GET() {
  return NextResponse.json({
    minimumShellVersionCode: APP_SHELL_VERSION_CODE,
    minimumShellVersionName: APP_SHELL_VERSION_NAME,
    blockOnIncompatible: false,
  });
}
