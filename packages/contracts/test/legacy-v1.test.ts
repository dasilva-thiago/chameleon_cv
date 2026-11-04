import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGACY_SCHEMA_VERSION, legacyProfileV1Schema } from '../src/index';
import { createStrictAjv } from '../scripts/ajv';

const legacyDir = resolve(__dirname, '../fixtures/legacy/v1.0.0');
const originalSchema = JSON.parse(
  readFileSync(resolve(legacyDir, 'profile-schema.v1.0.0.json'), 'utf8'),
) as object;

const minimal = { schema_version: '1.0.0', profile: {} };

describe('contrato legado 1.0.0 (somente leitura)', () => {
  it('versao', () => {
    expect(LEGACY_SCHEMA_VERSION).toBe('1.0.0');
  });

  it('o schema JSON original continua compilando no Ajv strict e aceita o perfil minimo', () => {
    const validate = createStrictAjv().compile(originalSchema);
    expect(validate(minimal)).toBe(true);
    expect(legacyProfileV1Schema.safeParse(minimal).success).toBe(true);
  });

  it('o Zod legado reflete o comportamento permissivo do 1.0.0: aceita objetos abertos e valores livres', () => {
    expect(
      legacyProfileV1Schema.safeParse({ ...minimal, profile: { typo_experinces: [] } }).success,
    ).toBe(true);
    expect(
      legacyProfileV1Schema.safeParse({
        ...minimal,
        profile: {
          experiences: [{ employment_type: 'banana', start_date: 'last summer', extra: 1 }],
        },
      }).success,
    ).toBe(true);
  });

  it('e tolerante com null onde o 1.0.0 original rejeitava (cabecalho do YAML: "use null")', () => {
    const withNulls = {
      ...minimal,
      profile: {
        experiences: [{ start_date: null }],
        courses: [{ completion_date: null }],
        certifications: [{ issue_date: null }],
      },
    };
    expect(createStrictAjv().compile(originalSchema)(withNulls)).toBe(false); // original rejeita
    expect(legacyProfileV1Schema.safeParse(withNulls).success).toBe(true); // legado tolerante aceita
  });

  it('rejeita versao diferente, raiz com chaves extras e tipos estruturais errados', () => {
    expect(legacyProfileV1Schema.safeParse({ schema_version: '2.0.0', profile: {} }).success).toBe(
      false,
    );
    expect(legacyProfileV1Schema.safeParse({ schema_version: '1.0.0' }).success).toBe(false);
    expect(legacyProfileV1Schema.safeParse({ ...minimal, extra: true }).success).toBe(false);
    expect(
      legacyProfileV1Schema.safeParse({ ...minimal, profile: { experiences: 'x' } }).success,
    ).toBe(false);
    expect(
      legacyProfileV1Schema.safeParse({ ...minimal, profile: { experiences: [1] } }).success,
    ).toBe(false);
    expect(
      legacyProfileV1Schema.safeParse({ ...minimal, profile: { identity: { full_name: 5 } } })
        .success,
    ).toBe(false);
  });
});
