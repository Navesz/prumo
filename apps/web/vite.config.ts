import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In development the SPA runs on Vite and the API on Fastify. In production
    // they are the same origin, because Fastify serves the built SPA — which is
    // what lets the session cookie be host-only.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/saude': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
