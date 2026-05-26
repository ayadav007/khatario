import type { Metadata, Viewport } from "next";
import { DM_Sans, Inter, Source_Sans_3 } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
});
import { AuthProvider } from "@/contexts/AuthContext";
import { NetworkStatusProvider } from "@/contexts/NetworkStatusContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { LayoutProvider } from "@/contexts/LayoutContext";
import { LayoutDataProvider } from "@/contexts/LayoutDataContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { DarkModeProvider } from "@/contexts/DarkModeContext";
import { DateRangeProvider } from "@/contexts/DateRangeContext";
import { ServiceWorkerRegistration } from "@/components/system/ServiceWorkerRegistration";
import { OfflineSyncProvider } from "@/contexts/OfflineSyncContext";
import { CatalogSyncProvider } from "@/contexts/CatalogSyncContext";

// Force all routes to be dynamic to prevent static generation issues with useSearchParams
export const dynamic = "force-dynamic";

const APP_NAME = "Khatario";
const APP_DEFAULT_TITLE = "Modern Invoice & Billing";
const APP_TITLE_TEMPLATE = "%s - Khatario";
const APP_DESCRIPTION =
  "Modern invoice and billing application for small businesses";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: {
    default: APP_DEFAULT_TITLE,
    template: APP_TITLE_TEMPLATE,
  },
  description: APP_DESCRIPTION,
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: { default: APP_DEFAULT_TITLE, template: APP_TITLE_TEMPLATE },
    description: APP_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: { default: APP_DEFAULT_TITLE, template: APP_TITLE_TEMPLATE },
    description: APP_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${dmSans.variable} ${sourceSans3.variable}`}>
      <body className="font-sans antialiased">
        <NetworkStatusProvider>
        <AuthProvider>
          <BranchProvider>
            <LayoutDataProvider>
                <LayoutProvider>
                  <ToastProvider>
                    <DarkModeProvider>
                      <OfflineSyncProvider>
                      <CatalogSyncProvider>
                      <DateRangeProvider>
                        <ServiceWorkerRegistration />
                        {children}
                      </DateRangeProvider>
                      </CatalogSyncProvider>
                      </OfflineSyncProvider>
                    </DarkModeProvider>
                  </ToastProvider>
                </LayoutProvider>
            </LayoutDataProvider>
          </BranchProvider>
        </AuthProvider>
        </NetworkStatusProvider>
      </body>
    </html>
  );
}
