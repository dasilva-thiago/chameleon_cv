/**
 * @chameleon/test-fixtures: perfis e vagas SINTETICOS (100% ficticios) e cenarios de teste.
 *
 * - Somente leitura de disco relativa ao pacote; sem rede.
 * - Importavel apenas por arquivos de teste (regra de lint em eslint.config.js).
 * - Nao valida contra o contrato v2 aqui: isso e feito por test/contract-validation.test.ts, que importa
 *   `@chameleon/contracts` e `@chameleon/profile-io` (esta ultima so como devDependency).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  EDGE_PROFILES,
  JOB_IDS,
  PROFILES,
  type EdgeProfileDescriptor,
  type EdgeProfileId,
  type JobId,
  type JobMeta,
  type ProfileDescriptor,
  type ProfileId,
} from './catalog';

export const PACKAGE_NAME = '@chameleon/test-fixtures' as const;

export * from './catalog';
export * from './scenarios';

/** Raiz do pacote (diretorio que contem `profiles/`, `profiles-edge/` e `jobs/`). */
export const FIXTURES_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const PROFILES_DIR = join(FIXTURES_ROOT, 'profiles');
export const EDGE_PROFILES_DIR = join(FIXTURES_ROOT, 'profiles-edge');
export const JOBS_DIR = join(FIXTURES_ROOT, 'jobs');

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

export function listProfiles(): readonly ProfileDescriptor[] {
  return PROFILES;
}

export function listProfileIds(): readonly ProfileId[] {
  return PROFILES.map((p) => p.id);
}

export function getProfileInfo(id: ProfileId): ProfileDescriptor {
  const info = PROFILES.find((p) => p.id === id);
  if (!info) throw new Error(`Fixture de perfil desconhecida: ${id}`);
  return info;
}

export function profilePath(id: ProfileId): string {
  return join(PROFILES_DIR, `${id}.yaml`);
}

/** Texto YAML bruto do perfil (util para testes de importacao, que partem de texto). */
export function loadProfileYaml(id: ProfileId): string {
  getProfileInfo(id);
  return readFileSync(profilePath(id), 'utf8');
}

/** YAML ja parseado (sem validacao de contrato). */
export function loadProfile(id: ProfileId): Record<string, unknown> {
  return parseProfileYaml(loadProfileYaml(id));
}

/** Perfis no formato intercambio 2.0.0. */
export function listV2ProfileIds(): readonly ProfileId[] {
  return PROFILES.filter((p) => p.format === 'v2').map((p) => p.id);
}

/** Perfis no formato legado 1.0.0 (migracao). */
export function listLegacyProfileIds(): readonly ProfileId[] {
  return PROFILES.filter((p) => p.format === 'v1').map((p) => p.id);
}

export function parseProfileYaml(text: string): Record<string, unknown> {
  const parsed: unknown = parseYaml(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('O YAML do perfil precisa ter um objeto na raiz.');
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Casos de borda de importacao
// ---------------------------------------------------------------------------

export function listEdgeProfiles(): readonly EdgeProfileDescriptor[] {
  return EDGE_PROFILES;
}

export function edgeProfileFile(id: EdgeProfileId): string {
  const descriptor: EdgeProfileDescriptor | undefined = EDGE_PROFILES.find((p) => p.id === id);
  return descriptor?.file ?? `${id}.yaml`;
}

export function edgeProfilePath(id: EdgeProfileId): string {
  return join(EDGE_PROFILES_DIR, edgeProfileFile(id));
}

export function loadEdgeProfileYaml(id: EdgeProfileId): string {
  if (!EDGE_PROFILES.some((p) => p.id === id)) {
    throw new Error(`Fixture de borda desconhecida: ${id}`);
  }
  return readFileSync(edgeProfilePath(id), 'utf8');
}

// ---------------------------------------------------------------------------
// Vagas
// ---------------------------------------------------------------------------

export function listJobs(): readonly JobId[] {
  return JOB_IDS;
}

export function jobTextPath(id: JobId): string {
  return join(JOBS_DIR, `${id}.txt`);
}

export function jobMetaPath(id: JobId): string {
  return join(JOBS_DIR, `${id}.meta.json`);
}

function assertJobId(id: string): asserts id is JobId {
  if (!(JOB_IDS as readonly string[]).includes(id)) {
    throw new Error(`Fixture de vaga desconhecida: ${id}`);
  }
}

/** Texto bruto da vaga, como o usuario o colaria. */
export function loadJobText(id: JobId): string {
  assertJobId(id);
  return readFileSync(jobTextPath(id), 'utf8');
}

export function loadJobMeta(id: JobId): JobMeta {
  assertJobId(id);
  return JSON.parse(readFileSync(jobMetaPath(id), 'utf8')) as JobMeta;
}

export function loadJob(id: JobId): { readonly meta: JobMeta; readonly text: string } {
  return { meta: loadJobMeta(id), text: loadJobText(id) };
}

// ---------------------------------------------------------------------------
// Canarios (rastreabilidade de vazamento)
// ---------------------------------------------------------------------------

/**
 * Canario = `CANARY-<slug-da-fixture>-<campo>`. O slug e o id da fixture sem pontos
 * (`legacy-1.0.0-filled` -> `legacy-100-filled`); o campo usa `_` entre palavras.
 */
export const CANARY_PATTERN = /CANARY-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:_[A-Za-z0-9]+)*/g;

export function canarySlug(fixtureId: string): string {
  return fixtureId.replaceAll('.', '');
}

export function extractCanaries(text: string): string[] {
  return [...text.matchAll(CANARY_PATTERN)].map((m) => m[0]);
}

export interface CanaryRecord {
  readonly canary: string;
  readonly fixtureKind: 'profile' | 'job';
  readonly fixtureId: string;
}

/** Todos os canarios de perfis e vagas, para uso em testes de vazamento/isolamento. */
export function listCanaries(): readonly CanaryRecord[] {
  const records: CanaryRecord[] = [];
  for (const id of listProfileIds()) {
    for (const canary of new Set(extractCanaries(loadProfileYaml(id)))) {
      records.push({ canary, fixtureKind: 'profile', fixtureId: id });
    }
  }
  for (const id of listJobs()) {
    for (const canary of new Set(extractCanaries(loadJobText(id)))) {
      records.push({ canary, fixtureKind: 'job', fixtureId: id });
    }
  }
  return records;
}

/** Canarios de um unico perfil. */
export function listProfileCanaries(id: ProfileId): readonly string[] {
  return [...new Set(extractCanaries(loadProfileYaml(id)))];
}

// ---------------------------------------------------------------------------
// Diagnostico: arquivos em disco (usado pelos testes de consistencia do catalogo)
// ---------------------------------------------------------------------------

export function listFilesOnDisk(dir: string): string[] {
  return readdirSync(dir).sort();
}
