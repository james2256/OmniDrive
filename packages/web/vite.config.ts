import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = parseInt(env.WEB_PORT || env.PORT || '8999', 10)
  const workerPort = parseInt(env.WORKER_PORT || '8888', 10)

  return {
    plugins: [react()],
    build: {
      // Split heavy vendor so dashboard/recharts isn't on the login critical path
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'recharts', test: /node_modules\/(?:recharts|d3-|victory-)/ },
              { name: 'react', test: /node_modules\/(?:react-dom|react\/|scheduler)/ },
              { name: 'router', test: /node_modules\/react-router/ },
            ],
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
