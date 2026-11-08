import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' makes the build work from any static host path (GitHub Pages, Netlify, S3, file share).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  server: { port: 5179 },
})
