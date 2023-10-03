import { resolve } from 'path'
import { defineConfig } from 'vite'
import { terser } from 'rollup-plugin-terser';

export default defineConfig({
  build: {
    minify: 'terser',
    cssMinify: true,
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: [
        resolve(__dirname, 'src/core/index.ts'),
        resolve(__dirname, 'src/render/vue3.ts'),
        resolve(__dirname, 'src/render/webComponent.ts'),
        resolve(__dirname, 'src/style.ts'),
        resolve(__dirname, 'src/plugins/animate.ts'),
      ],
      // the proper extensions will be added
      name: 'SplitPanel',
    },
    rollupOptions: {
      plugins: [
        terser({
          compress: true,
          mangle: true,
        })
      ],
      // make sure to externalize deps that shouldn't be bundled
      // into your library
      external: ['vue', 'madronejs'],
      output: {
        // Provide global variables to use in the UMD build
        // for externalized deps
        globals: {
          vue: 'Vue',
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
