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
