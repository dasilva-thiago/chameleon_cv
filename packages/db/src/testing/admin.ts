import pg from 'pg';

/**
 * Utilitarios de administracao do banco de testes (ADR-0002). Tudo aqui recusa hosts nao locais:
 * o harness cria e DESTROI bancos, entao nunca pode apontar para um servidor remoto.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** Bancos que o harness cria e pode remover. Qualquer outro nome e recusado. */
export const TEST_DB_PREFIX = 'chameleon_test_';
export const TEMPLATE_PREFIX = `${TEST_DB_PREFIX}tpl_`;
const SAFE_NAME_RE = /^chameleon_test_[a-z0-9_]{1,40}$/;

export function assertLocalConnectionString(connectionString: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${label} nao e uma URL de conexao valida.`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `${label} recusada: o host "${url.hostname}" nao e local (somente 127.0.0.1, localhost ou ::1). ` +
        'O harness de testes cria e remove bancos e nunca opera em servidor remoto.',
    );
  }
  return url;
}

/** Le TEST_DATABASE_ADMIN_URL (obrigatoria) e valida que o host e local. */
export function resolveAdminUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.TEST_DATABASE_ADMIN_URL;
  if (!raw) {
    throw new Error(
      'TEST_DATABASE_ADMIN_URL nao definida (veja .env.example). Inicie o banco: pnpm db:local:start',
    );
  }
  assertLocalConnectionString(raw, 'TEST_DATABASE_ADMIN_URL');
  return raw;
}

export function assertSafeTestDbName(name: string): void {
  if (!SAFE_NAME_RE.test(name)) {
    throw new Error(`Nome de banco de teste invalido ou nao permitido: "${name}".`);
  }
}

/** Mesma conexao do admin, apontando para outro banco. */
export function urlForDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

export function quoteIdent(name: string): string {
  assertSafeTestDbName(name);
  return `"${name}"`;
}

/** Executa `fn` com um cliente administrativo de vida curta (conecta e encerra). */
export async function withAdmin<T>(
  adminUrl: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function databaseExists(client: pg.Client, name: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return result.rowCount === 1;
}

export async function dropDatabase(client: pg.Client, name: string): Promise<void> {
  // WITH (FORCE) encerra conexoes remanescentes (PostgreSQL >= 13).
  await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
}

/** Marca o banco com a data de criacao (epoch ms) para a varredura de bancos orfaos. */
export async function stampDatabase(client: pg.Client, name: string): Promise<void> {
  await client.query(`COMMENT ON DATABASE ${quoteIdent(name)} IS 'chameleon-test:${Date.now()}'`);
}
