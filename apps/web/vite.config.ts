import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Le o .env da raiz do monorepo (sem prefixo): apenas API_PORT e usada aqui, no proxy de dev.
  const env = loadEnv(mode, '../..', '');
  const apiPort = env.API_PORT ?? '3000';
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
  };
});
