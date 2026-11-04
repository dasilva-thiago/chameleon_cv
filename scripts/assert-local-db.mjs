#!/usr/bin/env node
/**
 * Guarda de `pnpm db:reset`: recusa operar se o host de DATABASE_URL nao for local
 * (ADR-0002). Le DATABASE_URL do ambiente ou do .env da raiz.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');

const fileEnv = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const raw = process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;

if (!raw) {
  console.error('DATABASE_URL nao definida (ambiente ou .env). Recusando db:reset.');
  process.exit(1);
}

let host;
try {
  host = new URL(raw).hostname;
} catch {
  console.error('DATABASE_URL invalida. Recusando db:reset.');
  process.exit(1);
}

if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(
    `db:reset recusado: o host "${host}" nao e local (somente 127.0.0.1 ou localhost).`,
  );
  process.exit(1);
}
