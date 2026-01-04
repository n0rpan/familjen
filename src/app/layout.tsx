import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Outfit, Fraunces } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { LanguageProvider } from "@/lib/i18n/context";
import { getLanguageFromCookieOrBrowser } from "@/lib/i18n/cookie.server";
import { DEFAULT_LANGUAGE } from "@/lib/i18n/types";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { AppShell } from "@/components/AppShell";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { RealtimeWrapper } from "@/components/RealtimeWrapper";
import { NavigationProvider } from "@/lib/navigation";
import { PageContent } from "@/components/PageContent";
import { DemoWrapper } from "@/components/demo/DemoWrapper";

// Self-hosted fonts with next/font for better performance (no render-blocking)
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-outfit',
  display: 'swap',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-fraunces',
  display: 'swap',
});

export const metadata: Metadata = {
  title: "Familjen",
  description: "Familieplanlegging for hverdagen",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Familjen",
  },
  icons: {
    icon: [
      { url: "/icons/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#E8786D',
};

/**
 * Server component that reads cookies for language detection.
 * Must be wrapped in Suspense for Next.js 16 cacheComponents compatibility.
 */
async function AppContent({ children }: { children: React.ReactNode }) {
  const language = await getLanguageFromCookieOrBrowser()

  return (
    <LanguageProvider initialLanguage={language}>
      <NavigationProvider>
        <DemoWrapper>
          <RealtimeWrapper>
            <OfflineIndicator />
            <Header />
            <div className="app-shell-content pt-mobile-header">
              <AppShell>
                <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-28 md:pb-6 relative z-0" style={{ viewTransitionName: 'page-content' }}>
                  <PageContent>
                    {children}
                  </PageContent>
                </main>
              </AppShell>
            </div>
            <UpdatePrompt />
          </RealtimeWrapper>
        </DemoWrapper>
      </NavigationProvider>
    </LanguageProvider>
  )
}

/**
 * Fallback UI while cookies are being read.
 * Uses default language for the static shell.
 */
function AppContentFallback({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider initialLanguage={DEFAULT_LANGUAGE}>
      <NavigationProvider>
        <DemoWrapper>
          <RealtimeWrapper>
            <OfflineIndicator />
            <Header />
            <div className="app-shell-content pt-mobile-header">
              <AppShell>
                <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-28 md:pb-6 relative z-0" style={{ viewTransitionName: 'page-content' }}>
                  <PageContent>
                    {children}
                  </PageContent>
                </main>
              </AppShell>
            </div>
            <UpdatePrompt />
          </RealtimeWrapper>
        </DemoWrapper>
      </NavigationProvider>
    </LanguageProvider>
  )
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang={DEFAULT_LANGUAGE} className={`${outfit.variable} ${fraunces.variable}`}>
      <body className="antialiased grain app-shell font-sans" style={{ background: 'var(--background)' }}>
        <Suspense fallback={<AppContentFallback>{children}</AppContentFallback>}>
          <AppContent>{children}</AppContent>
        </Suspense>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
