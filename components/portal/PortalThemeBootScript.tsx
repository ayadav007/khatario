import { PORTAL_THEME_BOOT_SCRIPT } from '@/lib/portal-theme-storage';

/** Runs before first paint to apply cached portal theme CSS variables. */
export function PortalThemeBootScript() {
  return (
    <script
      id="portal-theme-boot"
      dangerouslySetInnerHTML={{ __html: PORTAL_THEME_BOOT_SCRIPT }}
    />
  );
}
