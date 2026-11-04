#!/usr/bin/env node
/**
 * Cluster PostgreSQL local do projeto (ADR-0002): init | start | stop | status.
 *
 * - Usa os binarios do PostgreSQL ja instalados (PG_BIN, PATH ou
 *   C:\Program Files\PostgreSQL\<versao>\bin, a maior versao encontrada).
 * - Dados em .data/pg (gitignored), superusuario `chameleon` com auth `trust`,
 *   escutando SOMENTE em 127.0.0.1:54329. O servico da porta 5432 nunca e tocado.
 * - Todo processo e iniciado com spawn + argumentos em array (caminhos com espaco, R4).
 *
 * O modo `trust` e inseguro por design: so existe para desenvolvimento local.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_ROOT = join(ROOT, '.data');
const PG_DATA = join(DATA_ROOT, 'pg');
const PG_LOG = join(DATA_ROOT, 'pg.log');

const HOST = '127.0.0.1';
const PORT = 54329;
const SUPERUSER = 'chameleon';
const DATABASES = ['chameleon', 'chameleon_dev'];
const MIN_MAJOR = 16;

const IS_WINDOWS = process.platform === 'win32';
const EXE = IS_WINDOWS ? '.exe' : '';

class UserError extends Error {}

// ---------------------------------------------------------------------------
// Localizacao dos binarios
// ---------------------------------------------------------------------------

function hasBinaries(dir) {
  return ['pg_ctl', 'initdb', 'psql', 'postgres'].every((name) =>
    existsSync(join(dir, name + EXE)),
  );
}

function versionKey(name) {
  const major = Number.parseInt(name, 10);
  return Number.isNaN(major) ? -1 : major;
}

function findPgBin() {
  const fromEnv = process.env.PG_BIN;
  if (fromEnv) {
    if (!hasBinaries(fromEnv)) {
      throw new UserError(`PG_BIN="${fromEnv}" nao contem pg_ctl, initdb, psql e postgres.`);
    }
    return fromEnv;
  }

  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    if (hasBinaries(dir)) {
      return dir;
    }
  }

  if (IS_WINDOWS) {
    const bases = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files']
      .filter(Boolean)
      .map((base) => join(base, 'PostgreSQL'));
    const candidates = [];
    for (const base of new Set(bases)) {
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base)) {
        const bin = join(base, entry, 'bin');
        if (versionKey(entry) >= 0 && hasBinaries(bin)) {
          candidates.push({ major: versionKey(entry), bin });
        }
      }
    }
    candidates.sort((a, b) => b.major - a.major);
    if (candidates[0]) {
      return candidates[0].bin;
    }
  }

  throw new UserError(
    'Binarios do PostgreSQL nao encontrados. Instale o PostgreSQL (>= 16) ou defina PG_BIN ' +
      'com o diretorio "bin" (ex.: C:\\Program Files\\PostgreSQL\\18\\bin).',
  );
}

// ---------------------------------------------------------------------------
// Execucao de processos (spawn, sem shell, argumentos em array)
// ---------------------------------------------------------------------------

/** Ambiente limpo de variaveis PG* do usuario, para nao herdar host/porta/senha por engano. */
function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !(key.startsWith('PG') && key !== 'PG_BIN')) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Executa um binario e devolve { code, stdout, stderr }.
 * `detach: true` e para `pg_ctl start`: o servidor herdaria os pipes e o fechamento
 * dos streams nunca ocorreria; nesse caso a saida nao e capturada.
 */
function run(binary, args, { detach = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      env: cleanEnv(),
      shell: false,
      windowsHide: true,
      stdio: detach ? 'ignore' : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on(detach ? 'exit' : 'close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function mustRun(binary, args, what) {
  const result = await run(binary, args);
  if (result.code !== 0) {
    throw new UserError(
      `${what} falhou (codigo ${result.code}).\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

const bin = (dir, name) => join(dir, name + EXE);

// ---------------------------------------------------------------------------
// Configuracao do cluster
// ---------------------------------------------------------------------------

function isInitialized() {
  return existsSync(join(PG_DATA, 'PG_VERSION'));
}

const CONF_BEGIN = '# >>> chameleon dev-db (gerenciado por scripts/dev-db.mjs) >>>';
const CONF_END = '# <<< chameleon dev-db <<<';

function writeConfig() {
  const confPath = join(PG_DATA, 'postgresql.conf');
  let conf = readFileSync(confPath, 'utf8');
  const start = conf.indexOf(CONF_BEGIN);
  if (start !== -1) {
    const end = conf.indexOf(CONF_END, start);
    conf = conf.slice(0, start) + (end === -1 ? '' : conf.slice(end + CONF_END.length + 1));
  }
  conf =
    conf.trimEnd() +
    `\n\n${CONF_BEGIN}\nlisten_addresses = '${HOST}'\nport = ${PORT}\n${CONF_END}\n`;
  writeFileSync(confPath, conf);

  // Somente IPv4 loopback, com trust. Sem linhas de replicacao nem outros enderecos.
  writeFileSync(
    join(PG_DATA, 'pg_hba.conf'),
    `# Gerenciado por scripts/dev-db.mjs. Somente loopback IPv4; modo trust so para dev local.\n` +
      `host    all    all    ${HOST}/32    trust\n`,
  );
}

/** Recusa iniciar se a configuracao do cluster expuser algo alem de 127.0.0.1 (ADR-0002). */
function assertLoopbackOnly() {
  const lastSetting = (file, key) => {
    const path = join(PG_DATA, file);
    if (!existsSync(path)) return undefined;
    let value;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = new RegExp(`^\\s*${key}\\s*=\\s*'?([^'#\\s]*)'?`).exec(line);
      if (match) value = match[1];
    }
    return value;
  };
  const listen =
    lastSetting('postgresql.auto.conf', 'listen_addresses') ??
    lastSetting('postgresql.conf', 'listen_addresses');
  if (listen !== HOST) {
    throw new UserError(
      `listen_addresses="${listen}" no cluster local. Por seguranca (auth trust), somente "${HOST}" e permitido. ` +
        'Rode `pnpm db:local:init` novamente ou corrija o postgresql.conf.',
    );
  }
  const hba = readFileSync(join(PG_DATA, 'pg_hba.conf'), 'utf8');
  for (const line of hba.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const [type, , , address] = trimmed.split(/\s+/);
    if (type !== 'host' || address !== `${HOST}/32`) {
      throw new UserError(
        `pg_hba.conf contem regra fora do loopback IPv4: "${trimmed}". Recusando iniciar.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

async function serverRunning(pgBin) {
  const result = await run(bin(pgBin, 'pg_ctl'), ['status', '-D', PG_DATA]);
  return result.code === 0;
}

function psqlArgs(database, ...extra) {
  return [
    '-h',
    HOST,
    '-p',
    String(PORT),
    '-U',
    SUPERUSER,
    '-d',
    database,
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    ...extra,
  ];
}

async function psqlScalar(pgBin, database, sql) {
  const result = await mustRun(bin(pgBin, 'psql'), psqlArgs(database, '-tAc', sql), 'psql');
  return result.stdout.trim();
}

async function binaryVersion(pgBin) {
  const result = await mustRun(bin(pgBin, 'postgres'), ['--version'], 'postgres --version');
  return result.stdout.trim();
}

async function init() {
  const pgBin = findPgBin();
  const version = await binaryVersion(pgBin);
  const major = Number.parseInt(/\)\s*(\d+)/.exec(version)?.[1] ?? '0', 10);
  if (major < MIN_MAJOR) {
    throw new UserError(`${version}: e necessario PostgreSQL >= ${MIN_MAJOR}.`);
  }
  console.log(`Binarios: ${pgBin}\n${version}`);

  if (isInitialized()) {
    console.log(`Cluster ja inicializado em ${PG_DATA}. Reaplicando configuracao de loopback.`);
    writeConfig();
    return;
  }

  mkdirSync(DATA_ROOT, { recursive: true });
  await mustRun(
    bin(pgBin, 'initdb'),
    ['-D', PG_DATA, '-U', SUPERUSER, '--auth=trust', '-E', 'UTF8'],
    'initdb',
  );
  writeConfig();
  console.log(`Cluster criado em ${PG_DATA} (porta ${PORT}, somente ${HOST}).`);
  console.log('Proximo passo: pnpm db:local:start');
}

async function ensureDatabases(pgBin) {
  for (const name of DATABASES) {
    const exists = await psqlScalar(
      pgBin,
      'postgres',
      `SELECT 1 FROM pg_database WHERE datname = '${name}'`,
    );
    if (exists !== '1') {
      await mustRun(
        bin(pgBin, 'psql'),
        psqlArgs('postgres', '-c', `CREATE DATABASE "${name}"`),
        `CREATE DATABASE ${name}`,
      );
      console.log(`Banco criado: ${name}`);
    }
  }
}

async function start() {
  const pgBin = findPgBin();
  if (!isInitialized()) {
    throw new UserError('Cluster nao inicializado. Rode `pnpm db:local:init` primeiro.');
  }
  assertLoopbackOnly();

  if (await serverRunning(pgBin)) {
    console.log(`Servidor ja esta em execucao (${HOST}:${PORT}).`);
  } else {
    // Importante: -p/-c sao repetidos em -o por garantia; nunca usamos a porta 5432.
    await run(
      bin(pgBin, 'pg_ctl'),
      [
        'start',
        '-D',
        PG_DATA,
        '-l',
        PG_LOG,
        '-w',
        '-t',
        '60',
        '-o',
        `-p ${PORT} -c listen_addresses=${HOST}`,
      ],
      { detach: true },
    );
    if (!(await serverRunning(pgBin))) {
      throw new UserError(`O servidor nao iniciou. Consulte o log: ${PG_LOG}`);
    }
    console.log(`Servidor iniciado em ${HOST}:${PORT}.`);
  }
  await ensureDatabases(pgBin);
}

async function stop() {
  const pgBin = findPgBin();
  if (!isInitialized()) {
    throw new UserError('Cluster nao inicializado; nada a parar.');
  }
  if (!(await serverRunning(pgBin))) {
    console.log('Servidor ja esta parado.');
    return;
  }
  await mustRun(
    bin(pgBin, 'pg_ctl'),
    ['stop', '-D', PG_DATA, '-m', 'fast', '-w', '-t', '60'],
    'pg_ctl stop',
  );
  console.log('Servidor parado.');
}

/** Codigos de saida: 0 em execucao, 3 parado, 4 nao inicializado. */
async function status() {
  const pgBin = findPgBin();
  console.log(`Binarios: ${pgBin} (${await binaryVersion(pgBin)})`);
  console.log(`Dados:    ${PG_DATA}`);
  if (!isInitialized()) {
    console.log('Estado:   nao inicializado (rode `pnpm db:local:init`).');
    return 4;
  }
  if (!(await serverRunning(pgBin))) {
    console.log(`Estado:   parado (rode \`pnpm db:local:start\`).`);
    return 3;
  }
  const serverVersion = await psqlScalar(pgBin, 'postgres', 'SHOW server_version');
  const major = serverVersion.split('.')[0];
  const dbs = await psqlScalar(
    pgBin,
    'postgres',
    `SELECT string_agg(datname, ', ' ORDER BY datname) FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'`,
  );
  console.log(`Estado:   em execucao em ${HOST}:${PORT}`);
  console.log(`Servidor: PostgreSQL ${major} (server_version ${serverVersion})`);
  console.log(`Bancos:   ${dbs || '(nenhum)'}`);
  console.log(`URL:      postgresql://${SUPERUSER}@${HOST}:${PORT}/chameleon_dev`);
  return 0;
}

const COMMANDS = { init, start, stop, status };

async function main() {
  const command = process.argv[2];
  const handler = COMMANDS[command];
  if (!handler) {
    console.error('Uso: node scripts/dev-db.mjs <init|start|stop|status>');
    return 2;
  }
  try {
    return (await handler()) ?? 0;
  } catch (error) {
    if (error instanceof UserError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();
