module.exports = {
  serverExternalPackages: ['@sparticuz/chromium','puppeteer-core','tesseract.js','tesseract.js-core'],
  outputFileTracingIncludes: {
    '/api/track': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*'
    ],
    '/api/browser-track': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*'
    ],
    '/api/cron/refresh': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*'
    ]
  }
};
