// ── Copy static renderer assets (HTML/CSS) into dist/ ───────────────────────
// TypeScript's compiler only handles .ts files. This script mirrors the
// non-.ts files under src/renderer/ into dist/renderer/ so the packaged
// app can load them with loadFile().

import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcRenderer = path.join(root, 'src', 'renderer');
const dstRenderer = path.join(root, 'dist', 'renderer');

async function main() {
  if (!existsSync(srcRenderer)) {
    console.warn('[copy-assets] src/renderer not found — skipping.');
    return;
  }
  await mkdir(dstRenderer, { recursive: true });
  // Copy recursively, filtering out TypeScript sources and maps.
  await cp(srcRenderer, dstRenderer, {
    recursive: true,
    filter: (src) => {
      if (src.endsWith('.ts')) return false;
      if (src.endsWith('.ts.map')) return false;
      return true;
    },
  });
  console.log('[copy-assets] renderer static files copied.');
}

main().catch((err) => {
  console.error('[copy-assets] failed:', err);
  process.exit(1);
});
