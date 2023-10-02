import { resolve } from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      // Could also be a dictionary or array of multiple entry points
      entry: [
        resolve(__dirname, 'lib/index.ts'),
        // resolve(__dirname, 'lib/webc.ts'),
      ],
      name: 'SplitPanel',
      // the proper extensions will be added
      // esm - default format. cjs - for node require api (single bundle)
      // fileName: (format, entryName, ...rest) => {
      //   console.log('fileName:', format, entryName, ...rest);
      //   return `${entryName}.${format}`;
      // }
    },
    rollupOptions: {
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
