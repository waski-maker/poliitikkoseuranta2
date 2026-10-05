import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// VITE_BASE_PATH = sub-path of the deployment, e.g. "/poliitikkoseuranta2/" on
// GitHub Pages or "/" on an own domain / web hotel. Nothing is hard-coded.
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  envDir: '../..',
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
