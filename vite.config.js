import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' zodat de build overal werkt (GitHub Pages, subpad, lokaal bestand)
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
