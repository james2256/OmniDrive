import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PUBLIC_ASSET_FILES = ['robots.txt', 'llms.txt', 'sitemap.xml'] as const;
const PLACEHOLDER = '__PUBLIC_URL__';

/**
 * Vite 8 (Rolldown) copies public/ files to dist/ BEFORE closeBundle fires.
 * generateBundle/writeBundle can't intercept them (they're not in the bundle).
 * closeBundle reads from dist/ and mutates the files on disk.
 */
function replacePublicUrlInAssets(publicUrl: string): Plugin {
  return {
    name: 'omnidrive:replace-public-url',
    apply: 'build',
    closeBundle() {
      const outDir = this.environment?.config?.build?.outDir;
      if (!outDir) return;
      const resolvedOutDir = resolve(process.cwd(), outDir);
      for (const fileName of PUBLIC_ASSET_FILES) {
        const filePath = resolve(resolvedOutDir, fileName);
        if (!existsSync(filePath)) continue;
        const content = readFileSync(filePath, 'utf8');
        const replaced = content.replaceAll(PLACEHOLDER, publicUrl);
        writeFileSync(filePath, replaced);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const port = parseInt(env.WEB_PORT || env.PORT || '8999', 10);
  const workerPort = parseInt(env.WORKER_PORT || '8888', 10);
  const publicUrl = env.VITE_PUBLIC_URL?.replace(/\/+$/, '') || 'http://localhost:8999';

  if (env.VITE_PUBLIC_URL && !/^https?:\/\//.test(env.VITE_PUBLIC_URL)) {
    throw new Error('VITE_PUBLIC_URL is set but not a valid http(s) URL: ' + env.VITE_PUBLIC_URL);
  }

  if (!env.VITE_PUBLIC_URL) {
    console.warn(
      '[vite] VITE_PUBLIC_URL not set — using localhost fallback. ' +
        'Set it in Cloudflare Pages env vars for correct sitemap/robots URLs.',
    );
  }

  return {
    plugins: [react(), replacePublicUrlInAssets(publicUrl)],
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
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
    },
  };
});
