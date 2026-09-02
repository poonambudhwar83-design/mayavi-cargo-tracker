module.exports = {
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  outputFileTracingIncludes: {
    '/api/track': ['./node_modules/@sparticuz/chromium/bin/**']
  }
};
