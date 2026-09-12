module.exports = {
  serverExternalPackages: ['@sparticuz/chromium','puppeteer-core','tesseract.js','tesseract.js-core','wasm-feature-detect','bmp-js'],
  outputFileTracingIncludes: {
    '/api/track': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/bmp-js/**/*'
    ],
    '/api/browser-track': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/bmp-js/**/*'
    ],
    '/api/etihad-test': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/bmp-js/**/*'
    ],
    '/api/etihad-alt': [
      './node_modules/@sparticuz/chromium/bin/**/*'
    ],
    '/api/etihad-champ-test': [
      './node_modules/@sparticuz/chromium/bin/**/*'
    ],
    '/api/cron/refresh': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/bmp-js/**/*'
    ],
    '/api/saudia-screenshot': [
      './node_modules/tesseract.js/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/wasm-feature-detect/**/*',
      './node_modules/bmp-js/**/*'
    ]
  }
};
