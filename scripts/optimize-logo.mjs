import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const sources = [
  { svg: join(root, 'Azadrive.svg'), label: 'full' },
  { svg: join(root, 'Azadrive-icon.svg'), label: 'icon' },
];

const outputs = [
  { source: 'full', file: 'packages/web/public/logo.png', size: 512, quality: 90 },
  { source: 'full', file: 'logo.png', size: 512, quality: 90 },
  { source: 'icon', file: 'packages/web/public/apple-touch-icon.png', size: 180, quality: 90 },
  { source: 'icon', file: 'packages/web/public/favicon-32.png', size: 32, quality: 95 },
  { source: 'icon', file: 'packages/web/public/favicon-48.png', size: 48, quality: 95 },
  { source: 'icon', file: 'packages/web/public/logo-oauth-120.png', size: 120, quality: 92 },
];

const svgBuffers = Object.fromEntries(
  sources.map(({ svg, label }) => [label, readFileSync(svg)]),
);

mkdirSync(join(root, 'packages/web/public'), { recursive: true });

for (const { source, file, size, quality } of outputs) {
  const outPath = join(root, file);
  mkdirSync(dirname(outPath), { recursive: true });

  const buffer = await sharp(svgBuffers[source], { density: Math.max(144, Math.ceil((size / 120) * 300)) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ quality, compressionLevel: 9, palette: size <= 48 })
    .toBuffer();

  writeFileSync(outPath, buffer);
  console.log(`${file}: ${(buffer.length / 1024).toFixed(1)} KB (${size}px)`);
}