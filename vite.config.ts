/* eslint-disable unicorn/prefer-module */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import jsxPlugin from '@vitejs/plugin-vue-jsx';
import vuePlugin from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vuePlugin(), jsxPlugin()],
  build: {
    cssMinify: true,
    minify: process.env.NODE_ENV === 'production',
    lib: {
      // Two entries: the framework-free core (`splitpanel`) and a thin Vue
      // adapter (`vue`). Consumers pick the subpath that matches their stack;
      // the Vue bundle is never loaded by a non-Vue consumer.
      entry: {
        splitpanel: resolve(__dirname, 'src/index.ts'),
        vue: resolve(__dirname, 'src/vue/index.ts'),
      },
      name: 'SplitGrid',
      formats: ['es', 'cjs'],
      cssFileName: 'splitpanel',
    },
    rollupOptions: {
      // Vue is an optional peer dep — never bundle it.
      external: ['vue'],
      output: { globals: { vue: 'Vue' } },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
