import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client';
import {
  ACCOUNT_EXPORT_REGISTRY,
  EXPORT_SECTIONS,
  unclassifiedModels,
  type ExportClassification,
} from '../src/account';
import { GLOBAL_MODELS, PRIVATE_MODELS } from '../src/private-models';

/**
 * Account export completeness (ADR-0014): every Prisma model is either exported (with the section that
 * carries it) or explicitly excluded with a reason. A model added without a classification fails here
 * (and at compile time, because the registry is `satisfies Record<Prisma.ModelName, ...>`).
 */
const registry = ACCOUNT_EXPORT_REGISTRY as Record<string, ExportClassification>;
const allModels = Object.values(Prisma.ModelName) as string[];

describe('account export registry', () => {
  it('classifies every model of the schema, and nothing else', () => {
    expect(unclassifiedModels(allModels)).toEqual([]);
    expect(Object.keys(registry).sort()).toEqual([...allModels].sort());
  });

  it('a model without a classification is reported (the guard itself works)', () => {
    expect(unclassifiedModels([...allModels, 'FutureTable', 'AnotherOne'])).toEqual([
      'AnotherOne',
      'FutureTable',
    ]);
    expect(unclassifiedModels([])).toEqual([]);
  });

  it('covers every private and global model of the isolation registry', () => {
    for (const model of [...PRIVATE_MODELS, ...Object.keys(GLOBAL_MODELS)]) {
      expect(registry[model], `${model} is not classified for export`).toBeDefined();
    }
  });

  it('every exclusion has a real reason and every inclusion names a known section', () => {
    for (const [model, entry] of Object.entries(registry)) {
      if (entry.status === 'excluded') {
        expect(entry.reason.trim().length, `${model} exclusion without reason`).toBeGreaterThan(20);
      } else {
        expect(EXPORT_SECTIONS, `${model}: unknown section`).toContain(entry.section);
      }
    }
  });

  it('every section is fed by at least one table', () => {
    const fed = new Set(
      Object.values(registry).flatMap((entry) =>
        entry.status === 'exported' ? [entry.section] : [],
      ),
    );
    expect([...fed].sort()).toEqual([...EXPORT_SECTIONS].sort());
  });

  it('secret columns are declared as withheld, never exported', () => {
    const withheld = (model: string): readonly string[] => {
      const entry = registry[model];
      return entry?.status === 'exported' ? (entry.withheld ?? []) : [];
    };
    expect(withheld('Credential')).toContain('passwordHash');
    expect(withheld('Session')).toContain('tokenHash');
    expect(withheld('Invite')).toContain('tokenHash');
  });

  it('only owner-less models may be excluded', () => {
    const ownerLess = new Set<string>(Object.keys(GLOBAL_MODELS));
    for (const [model, entry] of Object.entries(registry)) {
      if (entry.status === 'excluded') {
        expect(ownerLess.has(model), `${model} holds owner data but is not exported`).toBe(true);
      }
    }
  });
});
