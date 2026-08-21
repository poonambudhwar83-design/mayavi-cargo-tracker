/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
    outputFileTracingIncludes: {
      '/api/track': [
        './node_modules/@sparticuz/chromium/bin/**/*',
        './node_modules/@sparticuz/chromium/build/**/*'
      ]
    }
  }
};

module.exports = nextConfig;
