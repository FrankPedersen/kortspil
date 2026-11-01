import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Den fælles GitHub Pages-workflow angiver Kasino-appens base-sti ved build.
const kasinoRoot = fileURLToPath(new URL('.', import.meta.url));
let buildBase = '/kasino/';

export default defineConfig({
  base: '/kasino/',
  plugins: [
    react(),
    {
      name: 'copy-api-game-assets',
      configResolved(config) {
        buildBase = config.base;
      },
      closeBundle() {
        if (buildBase !== '/kasino/') return;
        const output = resolve(kasinoRoot, '..', 'backend', 'public', 'kasino');
        mkdirSync(output, { recursive: true });
        cpSync(resolve(kasinoRoot, 'dist'), output, { recursive: true });
      },
    },
  ],
});
