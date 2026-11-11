import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/LoL-Cham/',
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
})
