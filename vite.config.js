import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { open: '/dev/preview.html' },
  build: {
    lib: {
      entry: 'src/main.js',
      formats: ['es'],
      fileName: () => 'dicer.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
