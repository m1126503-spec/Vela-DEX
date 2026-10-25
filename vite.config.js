import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { handleChainstackRpcRequest, MAX_RPC_BODY_BYTES } from './server/chainstackRpc.js';

function chainstackRpcDevPlugin(env) {
  return {
    name: 'chainstack-rpc-dev',
    configureServer(server) {
      server.middlewares.use('/api/chainstack-rpc', async (request, response) => {
        let body = '';
        try {
          for await (const chunk of request) {
            body += chunk.toString('utf8');
            if (Buffer.byteLength(body, 'utf8') > MAX_RPC_BODY_BYTES) {
              response.statusCode = 413;
              response.setHeader('Content-Type', 'application/json');
              response.end(JSON.stringify({ error: 'JSON-RPC request is too large.' }));
              return;
            }
          }
          const result = await handleChainstackRpcRequest({
            method: request.method,
            body,
            env
          });
          response.statusCode = result.status;
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify(result.body));
        } catch {
          response.statusCode = 400;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'Invalid JSON-RPC request.' }));
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      chainstackRpcDevPlugin(serverEnv),
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
    },
    build: {
      target: 'esnext',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@ton/') || id.includes('@tonconnect/')) return 'ton-vendor';
            if (id.includes('@ston-fi/')) return 'ston-vendor';
            if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor';
            if (id.includes('@vercel/')) return 'vercel-vendor';
            return 'vendor';
          }
        }
      }
    }
  };
});
