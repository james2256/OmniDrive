import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = parseInt(env.WEB_PORT || env.PORT || '8999', 10)
  const workerPort = parseInt(env.WORKER_PORT || '8888', 10)

  return {
    plugins: [react()],
    build: {
      // ponytail: split heavy vendor so dashboard/recharts isn't on the login critical path
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-') || id.includes('node_modules/victory-')) {
              return 'recharts';
            }
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) {
              return 'react';
            }
            if (id.includes('node_modules/react-router')) {
              return 'router';
            }
          },
        },
      },
    },
    server: {
      port,
      proxy: {
        '/api': {
          target: `http://localhost:${workerPort}`,
          changeOrigin: true,
        },
        '/s3': {
          target: `http://localhost:${workerPort}`,
          changeOrigin: true,
        },
      }
    },
    test: {
      environment: 'jsdom',
      globals: true,
    }
  }
})
