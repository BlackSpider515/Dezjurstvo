import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base задаётся в GitHub Actions: /<имя-репозитория>/
// локально и в демо-режиме — '/'
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
  },
  server: {
    port: 5173,
    host: true,
  },
})
