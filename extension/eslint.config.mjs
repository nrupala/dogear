// ESLint flat config — DogEar browser extension (1.1.0).
// Plain scripts in three contexts (background service worker,
// content script, popup) sharing the chrome.* surface and the
// vendored reader-core engine. The lint's job in CI: catch
// syntax errors and undefined names on every push.
const extGlobals = {
  chrome: 'readonly', browser: 'readonly',
  window: 'readonly', document: 'readonly', navigator: 'readonly',
  localStorage: 'readonly',
  location: 'readonly', fetch: 'readonly', URL: 'readonly',
  Blob: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  console: 'readonly', Event: 'readonly', MouseEvent: 'readonly',
  CustomEvent: 'readonly', NodeFilter: 'readonly',
  SpeechSynthesisUtterance: 'readonly', speechSynthesis: 'readonly',
  addEventListener: 'readonly', removeEventListener: 'readonly',
  self: 'readonly', importScripts: 'readonly',
  ReaderCore: 'readonly',
};
export default [
  {
    files: ['*.js', 'vendor/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: extGlobals,
    },
    rules: {
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-redeclare': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: ['vendor/**/*.js'],
    languageOptions: {
      globals: { module: 'readonly', exports: 'readonly' },
    },
  },
];
