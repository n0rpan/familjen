import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { LanguageProvider } from "@/lib/i18n/context";
import { getLanguageFromCookieOrBrowser } from "@/lib/i18n/cookie.server";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { UpdatePrompt } from "@/components/UpdatePrompt";

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
    <html lang={language}>
      <body className="antialiased min-h-screen grain" style={{ background: 'var(--background)' }}>
        <LanguageProvider initialLanguage={language}>
          <Header />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-6">
            {children}
          </main>
          <UpdatePrompt />
        </LanguageProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
