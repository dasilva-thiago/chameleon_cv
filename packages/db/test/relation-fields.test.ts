import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/client';
import { relationFieldsOfClient } from '../src/for-owner';
import { Prisma } from '../src/generated/prisma/client';
import { PRIVATE_MODELS } from '../src/private-models';

/**
 * A lista de campos de relacao usada pelo forOwner vem do modelo de dados do client gerado (o Prisma 7
 * nao exporta `Prisma.dmmf`). Este teste a confere, de forma independente, contra os arquivos
 * `prisma/schema/*.prisma`: se o Prisma mudar o formato interno ou o client estiver desatualizado, a
 * suite falha em vez de o isolamento ficar silenciosamente incompleto.
 */
const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'schema');

function parseSchemaRelations(): Map<string, Set<string>> {
  const blocks = new Map<string, string>();
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.prisma'))) {
    const source = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    for (const match of source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      blocks.set(match[1]!, match[2]!);
    }
  }
  const modelNames = new Set(blocks.keys());
  const result = new Map<string, Set<string>>();
  for (const [model, body] of blocks) {
    const relations = new Set<string>();
    for (const line of body.split('\n')) {
      const field = /^\s*(\w+)\s+(\w+)(\?|\[\])?(\s|$)/.exec(line);
      // Campo cujo tipo e outro model = relacao (enums e escalares nao estao em `modelNames`).
      if (field && modelNames.has(field[2]!) && !line.trim().startsWith('@@')) {
        relations.add(field[1]!);
      }
    }
    result.set(model, relations);
  }
  return result;
}

describe('campos de relacao do forOwner x schema Prisma', () => {
  const db = createDb({ connectionString: 'postgresql://u:p@127.0.0.1:1/nao_conecta' });
  const fromClient = relationFieldsOfClient(db.unsafeRaw);
  const fromSchema = parseSchemaRelations();

  it('o client gerado cobre exatamente os models do schema', () => {
    expect([...fromClient.keys()].sort()).toEqual(Object.values(Prisma.ModelName).sort());
    expect([...fromSchema.keys()].sort()).toEqual(Object.values(Prisma.ModelName).sort());
  });

  it('cada model tem as mesmas relacoes nas duas fontes', () => {
    for (const [model, relations] of fromSchema) {
      expect([...(fromClient.get(model) ?? [])].sort(), model).toEqual([...relations].sort());
    }
  });

  it('todo model privado com FK tem ao menos uma relacao conhecida (sanidade do parser)', () => {
    for (const model of PRIVATE_MODELS) {
      expect(fromClient.get(model)?.size, model).toBeGreaterThan(0);
    }
    expect(fromClient.get('Resume')).toEqual(new Set(['job', 'versions']));
  });
});
