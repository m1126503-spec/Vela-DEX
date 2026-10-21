import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true },
      protocolImports: true
    })
  ],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173
  }
});