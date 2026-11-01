import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Den fælles GitHub Pages-workflow angiver Kasino-appens base-sti ved build.
export default defineConfig({
  plugins: [react()],
});
