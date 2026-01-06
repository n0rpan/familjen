import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable Partial Prerendering for instant page loads
  // In Next.js 16, PPR is enabled via cacheComponents
  cacheComponents: true,

  // Hide dev indicators (the "1 Issue" badge in bottom-left)
  // These only appear in development anyway, but this ensures clean screenshots
  devIndicators: false,

  // Disable X-Powered-By header to reduce fingerprinting
  poweredByHeader: false,

  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
  },

  // Bundle optimization - tree shake server-only packages
  serverExternalPackages: ['googleapis'],

  // Compiler optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },

  // Enable gzip compression (default in production, explicit for clarity)
  compress: true,

  // Reduce build output verbosity
  logging: {
    fetches: {
      fullUrl: false,
    },
  },

  // Security headers
  async headers() {
    const isDev = process.env.NODE_ENV === 'development'

    // Build CSP directives
    // In development: unsafe-eval needed for HMR/Fast Refresh
    // In production: unsafe-eval can be dropped, but unsafe-inline still needed
    // for Next.js inline scripts. For stricter CSP, use nonces via middleware.
    const scriptSrc = isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'"

    const cspDirectives = [
      "default-src 'self'",
      scriptSrc,
      // Tailwind and inline styles
      "style-src 'self' 'unsafe-inline'",
      // Images from self, data URIs, blobs, and HTTPS (Supabase signed URLs)
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      // API connections: self, Supabase, OpenRouter, Google
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://openrouter.ai https://accounts.google.com https://www.googleapis.com",
      // Web workers for SW
      "worker-src 'self'",
      // Manifest for PWA
      "manifest-src 'self'",
      // No iframes
      "frame-ancestors 'none'",
      // Form submissions only to self
      "form-action 'self'",
      // Base URI restriction
      "base-uri 'self'",
    ].join('; ')

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Content-Security-Policy',
            value: cspDirectives,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
