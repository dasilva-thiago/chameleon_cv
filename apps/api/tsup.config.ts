import { defineConfig } from 'tsup';

// Pacotes internos (@chameleon/*) sao consumidos como fonte TS: entram no bundle.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@chameleon\//],
});
