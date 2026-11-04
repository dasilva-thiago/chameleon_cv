import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import {
  TEMPLATE_PREFIX,
  assertLocalConnectionString,
  TEST_DB_PREFIX,
  databaseExists,
  dropDatabase,
  stampDatabase,
  urlForDatabase,
  withAdmin,
} from './admin';

/** packages/db (esta pasta e packages/db/src/testing). */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(PACKAGE_ROOT, 'prisma', 'migrations');

/** Chave do advisory lock que serializa a criacao do template entre processos/workers. */
const TEMPLATE_LOCK_KEY = 727_001;

const STALE_CLONE_MS = 6 * 60 * 60 * 1000;
const STALE_TEMPLATE_MS = 7 * 24 * 60 * 60 * 1000;

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    });
}

/** Hash do conteudo das migracoes: define o nome do template (muda quando uma migracao muda). */
export function migrationsHash(): string {
  const hash = createHash('sha256');
  for (const file of listFiles(MIGRATIONS_DIR)) {
    hash.update(relative(MIGRATIONS_DIR, file).replaceAll('\\', '/'));
    hash.update('\0');
    // Normaliza fim de linha: o hash nao pode depender de CRLF/LF do checkout.
    hash.update(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

export function templateName(): string {
  return `${TEMPLATE_PREFIX}${migrationsHash()}`;
}

function runMigrateDeploy(databaseUrl: string): Promise<void> {
  const prismaBin = join(PACKAGE_ROOT, 'node_modules', 'prisma', 'build', 'index.js');
  if (!existsSync(prismaBin)) {
    throw new Error(`CLI do Prisma nao encontrada em ${prismaBin}. Rode pnpm install.`);
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [prismaBin, 'migrate', 'deploy'], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`prisma migrate deploy falhou (codigo ${code}):\n${output}`));
    });
  });
}

/** Remove clones e templates orfaos (execucoes interrompidas) com base no carimbo de criacao. */
async function sweepStale(client: pg.Client, keepTemplate: string): Promise<void> {
  const { rows } = await client.query<{ datname: string; note: string | null }>(
    `SELECT d.datname, shobj_description(d.oid, 'pg_database') AS note
       FROM pg_database d WHERE d.datname LIKE $1`,
    [`${TEST_DB_PREFIX.replaceAll('_', '\\_')}%`],
  );
  const now = Date.now();
  for (const { datname, note } of rows) {
    if (datname === keepTemplate) continue;
    const created = Number(note?.startsWith('chameleon-test:') ? note.slice(15) : NaN);
    if (Number.isNaN(created)) continue; // sem carimbo: nao e nosso, nao mexe
    const limit = datname.startsWith(TEMPLATE_PREFIX) ? STALE_TEMPLATE_MS : STALE_CLONE_MS;
    if (now - created > limit) await dropDatabase(client, datname);
  }
}

const ready = new Map<string, Promise<string>>();

/**
 * Garante o banco-template migrado (`chameleon_test_tpl_<hash das migracoes>`) e devolve o nome.
 * Idempotente e seguro entre processos: o template e construido sob advisory lock em um banco
 * temporario e renomeado ao final, entao nunca existe um template pela metade.
 */
export async function ensureTemplateDatabase(adminUrl: string): Promise<string> {
  assertLocalConnectionString(adminUrl, 'adminUrl');
  let promise = ready.get(adminUrl);
  if (!promise) {
    promise = buildTemplate(adminUrl);
    ready.set(adminUrl, promise);
    promise.catch(() => ready.delete(adminUrl));
  }
  return promise;
}

async function buildTemplate(adminUrl: string): Promise<string> {
  const name = templateName();
  return withAdmin(adminUrl, async (client) => {
    await client.query('SELECT pg_advisory_lock($1)', [TEMPLATE_LOCK_KEY]);
    try {
      if (!(await databaseExists(client, name))) {
        const building = `${name}_b${process.pid}`;
        await dropDatabase(client, building);
        await client.query(`CREATE DATABASE "${building}"`);
        await stampDatabase(client, building);
        try {
          await runMigrateDeploy(urlForDatabase(adminUrl, building));
        } catch (error) {
          await dropDatabase(client, building);
          throw error;
        }
        await client.query(`ALTER DATABASE "${building}" RENAME TO "${name}"`);
      }
      await sweepStale(client, name);
      return name;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [TEMPLATE_LOCK_KEY]);
    }
  });
}
