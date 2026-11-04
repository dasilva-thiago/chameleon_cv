import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import {
  GLOBAL_MODELS,
  PRIVATE_MODELS,
  PRIVATE_RELATIONS_OF_GLOBAL,
  isPrivateModel,
} from '../src/private-models';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'schema');

function schemaModelBlocks(): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))) {
    const source = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      blocks.set(match[1]!, match[2]!);
    }
  }
  return blocks;
}

const allModels = Object.values(Prisma.ModelName) as string[];
const scalarFields = (model: string): string[] =>
  Object.values(
    (Prisma as unknown as Record<string, Record<string, string>>)[`${model}ScalarFieldEnum`] ?? {},
  );

describe('registro central de modelos privados (ADR-0008)', () => {
  it('todo model do schema esta no registro privado OU no global, nunca em ambos', () => {
    const privateSet = new Set<string>(PRIVATE_MODELS);
    const globalSet = new Set<string>(Object.keys(GLOBAL_MODELS));

    const unregistered = allModels.filter((m) => !privateSet.has(m) && !globalSet.has(m));
    expect(
      unregistered,
      `models fora do registro (src/private-models.ts): ${unregistered.join(', ')}`,
    ).toEqual([]);
    expect(allModels.filter((m) => privateSet.has(m) && globalSet.has(m))).toEqual([]);
    // Nada no registro que nao exista no schema (renomeacoes esquecidas).
    expect([...privateSet, ...globalSet].filter((m) => !allModels.includes(m))).toEqual([]);
  });

  it('o schema Prisma tem models (guarda contra parse vazio)', () => {
    expect(schemaModelBlocks().size).toBe(allModels.length);
    expect(allModels.length).toBeGreaterThan(0);
  });

  it('todo model privado tem coluna ownerId e @@unique([id, ownerId])', () => {
    const blocks = schemaModelBlocks();
    for (const model of PRIVATE_MODELS) {
      expect(scalarFields(model), `${model} sem ownerId`).toContain('ownerId');
      expect(blocks.get(model), `${model} sem @@unique([id, ownerId])`).toMatch(
        /@@unique\(\[id,\s*ownerId\]\)/,
      );
    }
  });

  it('modelo global nao tem ownerId (senao deveria ser privado)', () => {
    for (const model of Object.keys(GLOBAL_MODELS)) {
      expect(scalarFields(model), `${model} tem ownerId: registre-o como privado`).not.toContain(
        'ownerId',
      );
    }
  });

  it('isPrivateModel', () => {
    expect(isPrivateModel('Session')).toBe(true);
    expect(isPrivateModel('User')).toBe(false);
    expect(isPrivateModel('Inexistente')).toBe(false);
  });

  it('PRIVATE_RELATIONS_OF_GLOBAL lista todas as relacoes de modelos globais para privados', () => {
    const blocks = schemaModelBlocks();
    const privateSet = new Set<string>(PRIVATE_MODELS);
    for (const model of Object.keys(GLOBAL_MODELS)) {
      const found: string[] = [];
      for (const line of (blocks.get(model) ?? '').split('\n')) {
        const field = /^\s*(\w+)\s+(\w+)(?:\[\]|\?)?(?:\s|$)/.exec(line);
        if (field && privateSet.has(field[2]!)) found.push(field[1]!);
      }
      const registered = (PRIVATE_RELATIONS_OF_GLOBAL as Record<string, readonly string[]>)[model];
      expect([...(registered ?? [])].sort(), `relacoes privadas de ${model}`).toEqual(found.sort());
    }
  });

  it('toda justificativa global e nao vazia', () => {
    for (const reason of Object.values(GLOBAL_MODELS)) expect(reason.length).toBeGreaterThan(10);
  });
});
