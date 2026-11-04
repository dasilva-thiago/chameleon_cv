/**
 * Gerador dos JSON Schemas do contrato canonico (z.toJSONSchema; ADR-0003).
 *
 *   pnpm contracts:generate   grava packages/contracts/generated/profile-document.v2.schema.json
 *   pnpm contracts:check      falha (codigo 1) se o arquivo commitado diferir do gerado, ou se o
 *                             schema nao compilar no Ajv 2020-12 em modo strict.
 *
 * O arquivo gerado usa LF e termina com newline; a comparacao e feita sobre o texto exato.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProfileJsonSchema } from '../src/index';
import { compileStrict } from './ajv';

const here = dirname(fileURLToPath(import.meta.url));
export const GENERATED_DIR = resolve(here, '../generated');
export const PROFILE_SCHEMA_FILE = resolve(GENERATED_DIR, 'profile-document.v2.schema.json');

export function renderProfileSchema(): string {
  return `${JSON.stringify(buildProfileJsonSchema(), null, 2)}\n`;
}

function main(): void {
  const check = process.argv.includes('--check');
  const rendered = renderProfileSchema();

  try {
    compileStrict(JSON.parse(rendered) as object);
  } catch (error) {
    console.error('contracts: o JSON Schema gerado nao compila no Ajv 2020-12 (strict).');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  if (check) {
    const current = existsSync(PROFILE_SCHEMA_FILE)
      ? readFileSync(PROFILE_SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n')
      : null;
    if (current !== rendered) {
      console.error(
        'contracts:check - generated/profile-document.v2.schema.json esta desatualizado em relacao ao contrato Zod.\n' +
          'Rode `pnpm contracts:generate` e atualize os templates/fixtures afetados.',
      );
      process.exit(1);
    }
    console.log(
      'contracts:check - OK (schema gerado identico ao commitado e compila no Ajv 2020-12 strict).',
    );
    return;
  }

  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(PROFILE_SCHEMA_FILE, rendered, 'utf8');
  console.log(`contracts:generate - escrito ${PROFILE_SCHEMA_FILE}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
