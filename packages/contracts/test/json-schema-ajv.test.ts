import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProfileJsonSchema, PROFILE_JSON_SCHEMA_ID } from '../src/index';
import { compileStrict, createStrictAjv } from '../scripts/ajv';
import { PROFILE_SCHEMA_FILE, renderProfileSchema } from '../scripts/generate';
import { doc } from './helpers';

const generated = JSON.parse(
  readFileSync(PROFILE_SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n'),
) as Record<string, unknown>;

describe('JSON Schema gerado (z.toJSONSchema)', () => {
  it('o arquivo commitado e identico ao gerado agora (sem diff)', () => {
    const committed = readFileSync(PROFILE_SCHEMA_FILE, 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderProfileSchema());
  });

  it('tem $id estavel, draft 2020-12 e raiz fechada', () => {
    expect(generated.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(generated.$id).toBe(PROFILE_JSON_SCHEMA_ID);
    expect(generated.additionalProperties).toBe(false);
    expect(generated.required).toEqual(['schema_version', 'profile']);
    expect(String(generated.$id)).not.toContain('example.invalid');
  });

  it('compila no Ajv 2020-12 em modo strict', () => {
    expect(() => createStrictAjv().compile(generated)).not.toThrow();
    expect(() => compileStrict(buildProfileJsonSchema())).not.toThrow();
  });

  it('todos os objetos sao fechados (additionalProperties: false), nenhum esta aberto', () => {
    let objects = 0;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        const record = node as Record<string, unknown>;
        if (record.type === 'object' && record.properties) {
          objects += 1;
          expect(record.additionalProperties, JSON.stringify(Object.keys(record.properties))).toBe(
            false,
          );
        }
        Object.values(record).forEach(walk);
      }
    };
    walk(generated);
    expect(objects).toBeGreaterThan(50);
  });
});

describe('equivalencia estrutural JSON Schema x Zod (subconjunto)', () => {
  const validate = compileStrict(generated);
  const ajvOk = (input: unknown) => validate(input) === true;

  it('aceita perfil vazio, parcial e campos null', () => {
    expect(ajvOk(doc({}))).toBe(true);
    expect(
      ajvOk(
        doc({
          identity: { full_name: 'Ana' },
          experiences: [{ organization_name: 'X', start_date: null, end_date: 'present' }],
        }),
      ),
    ).toBe(true);
    expect(
      ajvOk(doc({ identity: null, experiences: null, usage_rules: { restrictions: [] } })),
    ).toBe(true);
  });

  it('rejeita enum invalido, data livre, chave desconhecida, URL, e-mail e salario negativo', () => {
    expect(
      ajvOk(doc({ experiences: [{ organization_name: 'X', employment_type: 'banana' }] })),
    ).toBe(false);
    expect(
      ajvOk(doc({ experiences: [{ organization_name: 'X', start_date: 'last summer' }] })),
    ).toBe(false);
    expect(ajvOk(doc({ typo: [] }))).toBe(false);
    expect(ajvOk(doc({ experiences: [{ organization_name: 'X', extra: 1 }] }))).toBe(false);
    expect(ajvOk(doc({ projects: [{ name: 'P', public_url: 'not a url' }] }))).toBe(false);
    expect(ajvOk(doc({ availability_preferences: { salary_expectation: { amount: -5 } } }))).toBe(
      false,
    );
    expect(ajvOk(doc({ identity: { full_name: '' } }))).toBe(false);
    expect(ajvOk({ schema_version: '1.0.0', profile: {} })).toBe(false);
  });

  it('NAO expressa integridade referencial: ids duplicados passam no JSON Schema (so o Zod rejeita)', () => {
    const duplicated = doc({
      experiences: [
        { id: 'A', organization_name: 'x' },
        { id: 'A', organization_name: 'y' },
      ],
    });
    expect(ajvOk(duplicated)).toBe(true);
    expect(JSON.stringify(generated.description).toLowerCase()).toContain('subconjunto');
  });
});
