import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { LanguageProvider } from "@/lib/i18n/context";
import { getLanguageFromCookieOrBrowser } from "@/lib/i18n/cookie.server";

export const metadata: Metadata = {
  title: "Familjen",
  description: "Familieplanlegging for hverdagen",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
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
        </LanguageProvider>
      </body>
    </html>
  );
}
