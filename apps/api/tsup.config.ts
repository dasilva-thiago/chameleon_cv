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
  // Dependencias CommonJS que entram no bundle ESM (ex.: `pg`, via @chameleon/db) chamam `require()` de modulos
  // nativos do Node; sem este shim o `dist/main.js` falha com "Dynamic require of ... is not supported".
  banner: {
    js: "import { createRequire as __chameleonCreateRequire } from 'node:module'; const require = __chameleonCreateRequire(import.meta.url);",
  },
});
