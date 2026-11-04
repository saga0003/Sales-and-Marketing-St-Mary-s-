import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.DEV_PORT || 5173),
    allowedHosts: [
      'terminal.local',
      ...(process.env.PREVIEW_HOST ? [process.env.PREVIEW_HOST] : []),
    ],
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  build: { target: 'es2022', sourcemap: false },
});
