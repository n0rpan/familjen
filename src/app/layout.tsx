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
 * Minimal fallback UI for static shell prerendering.
 * Must NOT include any components that access dynamic data (cookies, searchParams, etc.)
 * The full app content streams in once cookies are read.
 */
function AppContentFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse-soft">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--coral)" strokeWidth="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
    </div>
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
        <Suspense fallback={<AppContentFallback />}>
          <AppContent>{children}</AppContent>
        </Suspense>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
