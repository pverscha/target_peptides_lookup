import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Dev proxy: requests to /os/* are forwarded to OpenSearch at localhost:9200.
      // Configure opensearch.yml with http.cors.enabled: true for production use.
      '/os': {
        target: 'http://localhost:9200',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/os/, ''),
      },
    },
  },
})
