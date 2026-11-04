import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createVoidGatewayHandler } from './api/void-api/_gateway';

function localVoidGateway(): Plugin {
  const handler = createVoidGatewayHandler();
  return {
    name: 'void-song-api-gateway',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), localVoidGateway()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      ignored: ['**/VOID/**', '**/VOID-BACKEND/**'],
    },
  },
});
