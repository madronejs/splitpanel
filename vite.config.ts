/* eslint-disable unicorn/prefer-module */
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import jsxPlugin from '@vitejs/plugin-vue-jsx';

export default defineConfig({
  plugins: [jsxPlugin()],
  build: {
    cssMinify: true,
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: [
        resolve(__dirname, 'src/core/index.ts'),
        resolve(__dirname, 'src/render/vue3.tsx'),
        // resolve(__dirname, 'src/render/webComponent.ts'),
        resolve(__dirname, 'src/style.ts'),
        resolve(__dirname, 'src/plugins/animate.ts'),
        resolve(__dirname, 'src/plugins/draggable.ts'),
      ],
      // the proper extensions will be added
      name: 'SplitPanel',
    },
    rollupOptions: {
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ['vue', '@madronejs/core'],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
