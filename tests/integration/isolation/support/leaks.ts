import { expect } from 'vitest';
import { PRIVATE_MODELS } from './workspace';
import { delegateName, privateRowIds, type World } from './world';

/** Algo que NAO pode aparecer para um observador: rotulo (quem/o que) + valor procurado. */
export interface Forbidden {
  label: string;
  needle: string;
}

const idCache = new Map<string, string[]>();
async function cachedRowIds(world: World, ownerId: string): Promise<string[]> {
  const key = `${world.testDb.name}:${ownerId}`;
  let ids = idCache.get(key);
  if (!ids) idCache.set(key, (ids = await privateRowIds(world, ownerId)));
  return ids;
}

/**
 * Tudo que identifica os OUTROS donos: canarios de perfil, e-mails, ownerIds e ids de linhas
 * privadas (a existencia tambem e vazamento). Os dados do proprio observador ficam de fora.
 */
export async function forbiddenFor(
  world: World,
  viewer: { ownerId: string },
): Promise<Forbidden[]> {
  const forbidden: Forbidden[] = [];
  for (const other of world.everyone) {
    if (other.ownerId === viewer.ownerId) continue;
    for (const canary of other.canaries) {
      forbidden.push({ label: `canario ${other.label}`, needle: canary });
    }
    forbidden.push({ label: `e-mail de ${other.label}`, needle: other.email });
    forbidden.push({ label: `ownerId de ${other.label}`, needle: other.ownerId });
    for (const id of await cachedRowIds(world, other.ownerId)) {
      forbidden.push({ label: `id de linha de ${other.label}`, needle: id });
    }
  }
  return forbidden;
}

/** Comparacao sem diferenciar caixa (normalizadores costumam mudar a caixa de e-mails). */
export function findLeaks(haystack: string, forbidden: readonly Forbidden[]): string[] {
  const lowered = haystack.toLowerCase();
  const found = new Set<string>();
  for (const item of forbidden) {
    if (lowered.includes(item.needle.toLowerCase())) found.add(`${item.label}: ${item.needle}`);
  }
  return [...found];
}

export function expectNoLeaks(
  where: string,
  haystack: string,
  forbidden: readonly Forbidden[],
): void {
  expect(findLeaks(haystack, forbidden), `vazamento em ${where}`).toEqual([]);
}

/**
 * Serializa TUDO que o dono consegue ler pelas camadas internas: `forOwner` em TODOS os modelos privados
 * (base, revisoes, vagas, avaliacoes, curriculos, versoes, identidade).
 */
export async function readEverythingAs(world: World, viewer: { ownerId: string }): Promise<string> {
  const { testDb } = world;
  const parts: unknown[] = [];
  const scoped = testDb.db.forOwner(viewer.ownerId);
  for (const model of PRIVATE_MODELS) {
    const delegate = (scoped as unknown as Record<string, { findMany(): Promise<unknown[]> }>)[
      delegateName(model)
    ];
    if (!delegate) throw new Error(`delegate ausente para ${model}`);
    parts.push({ [model]: await delegate.findMany() });
  }
  return JSON.stringify(parts);
}
