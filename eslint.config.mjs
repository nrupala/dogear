// SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import globals from "globals";

// DogEar lint gate — flat config at the repo root (outside the shipped
// extension/ payload tree; extension/tools/build.py packages extension/
// only). Scope: the shipped extension scripts + the smoke test that
// drives them. Rule set: ESLint core correctness rules only — undefined
// names, unreachable code, duplicate keys, unsafe comparisons and
// friends. An error-catching gate, not a style gate.
//
// Calibration notes (2026-11-06), each tied to a read idiom in the code,
// NOT blanket disables — every error class above stays on:
// - no-implicit-globals is OFF: background.js / popup.js / content.js are
//   standalone MV3 entry scripts (service worker, popup, content script),
//   each loaded by the manifest as its own script; top-level declarations
//   are their own scope, not a shared page global. The rule targets
//   concatenated bundles, which this is not.
// - no-unused-vars uses caughtErrors:"none": `catch (e) {}` (swallow and
//   continue) is the codebase's deliberate idiom; unused non-catch
//   variables still error.
// - no-cond-assign uses "except-parens": the flagged site is the
//   parenthesised TreeWalker idiom `while ((n = walker.nextNode()))`;
//   a bare `if (a = b)` still errors.
// - reader-core.js declares `module` readonly: it is a UMD wrapper and
//   every use is behind `typeof module === 'object'`.
const correctness = {
  "no-undef": "error",
  "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_", caughtErrors: "none" }],
  "no-unreachable": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-cond-assign": ["error", "except-parens"],
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-fallthrough": "error",
  "no-redeclare": "error",
  "no-self-assign": "error",
  "no-unsafe-negation": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
};

export default [
  {
    // Shipped extension scripts: classic (non-module) MV3 scripts.
    files: [
      "extension/background.js",
      "extension/content.js",
      "extension/popup.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        chrome: "readonly",
        browser: "readonly",
      },
    },
    rules: correctness,
  },
  {
    // Vendored reader engine: UMD wrapper (see calibration notes).
    files: ["extension/vendor/reader-core/reader-core.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        module: "readonly",
      },
    },
    rules: correctness,
  },
  {
    // Smoke test: Node ESM.
    files: ["extension/tests/smoke.test.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: correctness,
  },
];
