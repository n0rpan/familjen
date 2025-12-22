import type { Metadata, Viewport } from "next";
import { Outfit, Fraunces } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/Header";
import { LanguageProvider } from "@/lib/i18n/context";
import { getLanguageFromCookieOrBrowser } from "@/lib/i18n/cookie.server";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { UpdatePrompt } from "@/components/UpdatePrompt";
import { AppShell } from "@/components/AppShell";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { RealtimeWrapper } from "@/components/RealtimeWrapper";
import { NavigationProvider } from "@/lib/navigation";
import { PageContent } from "@/components/PageContent";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await getLanguageFromCookieOrBrowser()

  return (
    <html lang={language} className={`${outfit.variable} ${fraunces.variable}`}>
      <body className="antialiased grain app-shell font-sans" style={{ background: 'var(--background)' }}>
        <LanguageProvider initialLanguage={language}>
          <NavigationProvider>
            <RealtimeWrapper>
              <OfflineIndicator />
              <Header />
              <div className="app-shell-content pt-mobile-header">
                <AppShell>
                  <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-24 md:pb-6 relative z-0" style={{ viewTransitionName: 'page-content' }}>
                    <PageContent>
                      {children}
                    </PageContent>
                  </main>
                </AppShell>
              </div>
              <UpdatePrompt />
            </RealtimeWrapper>
          </NavigationProvider>
        </LanguageProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
