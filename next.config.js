/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @sparticuz/chromium must stay external so it can resolve its own bin/*.br files.
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    // Vercel/Next output tracing can otherwise omit the Chromium Brotli binaries.
    outputFileTracingIncludes: {
      '/api/track': [
        './node_modules/@sparticuz/chromium/bin/**/*',
        './node_modules/@sparticuz/chromium/build/**/*'
      ]
    }
  }
};

module.exports = nextConfig;
