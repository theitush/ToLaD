/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev -- --host` exposes the dev server on the LAN.
    // allowedHosts: true lets tunnel hostnames (cloudflared, ngrok) through.
    allowedHosts: true,
    port: 5173,
  },
  preview: {
    allowedHosts: true,
    port: 4173,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
