/**
 * Vitest configuration with two projects:
 *
 *   - `node` — fast, no real browser. Pure functions and DOM-stub tests
 *     (happy-dom under a per-file `// @vitest-environment` pragma). Runs
 *     in milliseconds per file; this is where most assertions live.
 *
 *   - `browser` — Playwright-driven Chromium. Real CSS Grid layout, real
 *     getBoundingClientRect. Catches the class of bug that the node suite
 *     can't see by construction — JS-vs-CSS percentage drift, resizer
 *     overflow, transition timing. Slower (seconds), so reserved for
 *     end-to-end-shaped assertions only.
 *
 * File globs route tests to projects. `*.browser.spec.ts` files run in
 * the browser project; everything else runs in node. Both can import
 * from `src/` directly.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import vuePlugin from '@vitejs/plugin-vue';
import jsxPlugin from '@vitejs/plugin-vue-jsx';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [vuePlugin(), jsxPlugin()],
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          // Default no-DOM env for pure-fn tests. happy-dom is opted in
          // per-file via the `// @vitest-environment happy-dom` pragma at
          // the top of `*.dom.spec.ts` files.
          environment: 'node',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.browser.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.spec.ts'],
          browser: {
            enabled: true,
            // Vitest 4 expects a provider factory, not a string. The
            // playwright() factory wraps the Playwright driver; swap for
            // webdriverio() if Playwright ever isn't available.
            provider: playwright(),
            // Chromium-only for now. Add 'firefox' / 'webkit' here if a
            // cross-browser regression surfaces in real layout.
            instances: [{ browser: 'chromium' }],
            headless: true,
            // No screenshots/videos in CI by default — the failure assertion
            // is enough. Flip these on locally when chasing a flake.
            screenshotFailures: false,
          },
        },
      },
    ],
  },
});
