// tests/helpers/obsidian-resolver.cjs
//
// Vitest 4 only honors `resolve.alias` for ESM imports it transforms; the
// `require('obsidian')` calls inside `input.js` are handled by Node's CJS
// loader, which looks for `node_modules/obsidian/index.js` — but the
// installed `obsidian` package ships only `.d.ts` type definitions, so the
// require fails with `Cannot find module 'obsidian'`.
//
// Fix: monkey-patch `Module._resolveFilename` once per worker, before any
// test file runs, so every `require('obsidian')` resolves to our mock at
// `__mocks__/obsidian.js`. Wired in via `vitest.config.mjs` -> `setupFiles`.
//
// This keeps the existing alias semantics for ESM users and unblocks the
// CJS tests (settings_*, wechat_api, sync_modal_*, etc.) without touching
// node_modules or the production build.

const Module = require('module');
const path = require('path');

const mockPath = path.resolve(__dirname, '../../__mocks__/obsidian.js');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function patchedResolveFilename(request, parent, ...rest) {
  if (request === 'obsidian') {
    return mockPath;
  }
  return originalResolve.call(this, request, parent, ...rest);
};
