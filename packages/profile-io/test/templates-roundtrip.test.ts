import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  canonicalizeProfileDocument,
  listContractPaths,
  parseProfileDocument,
} from '@chameleon/contracts';
import { loadProfile, parseProfileText, serializeProfile } from '../src/index';
import {
  legacyFilledYaml,
  legacyTemplateYaml,
  v2CompleteYaml,
  v2PartialYaml,
  v2TemplateYaml,
} from './fixtures';

describe('template YAML v2 alinhado ao contrato', () => {
  const text = v2TemplateYaml();
  const parsed = parse(text, { schema: 'core', version: '1.2' }) as Record<string, unknown>;

  it('e YAML valido, declara 2.1.0 e e valido no contrato Zod', () => {
    expect(parsed.schema_version).toBe('2.1.0');
    expect(() => parseProfileDocument(JSON.parse(JSON.stringify(parsed)))).not.toThrow();
    expect(text.includes('\r')).toBe(false);
  });

  it('nao tem defaults com aparencia de fato (sem "" e sem valores de enum preenchidos)', () => {
    const lines = text.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    for (const line of lines) {
      const value = line.split('#')[0] ?? '';
      expect(value, line).not.toMatch(/:\s*""\s*$/);
      expect(value, line).not.toMatch(
        /:\s*(confirmed|needs_review|public|private|allowed|professional|true|false|\d+)\s*$/,
      );
    }
    expect(text).not.toMatch(/Não informado\s*$/m);
  });

  it('todo campo de bloco singleton esta presente como chave real (null/[]/{}) e todos os valores sao vazios', () => {
    const singleton = listContractPaths().filter(
      (path) => path.startsWith('profile.') && !path.includes('[]'),
    );
    expect(singleton.length).toBeGreaterThan(80);
    for (const path of singleton) {
      let cursor: unknown = parsed;
      for (const key of path.split('.')) {
        expect(cursor && typeof cursor === 'object' && key in cursor, path).toBe(true);
        cursor = (cursor as Record<string, unknown>)[key];
      }
      const empty =
        cursor === null ||
        (Array.isArray(cursor) && cursor.length === 0) ||
        (typeof cursor === 'object' && Object.keys(cursor).length === 0);
      expect(empty, `${path} deveria estar vazio`).toBe(true);
    }
  });

  it('toda colecao e [] e todo campo de registro aparece no exemplo comentado', () => {
    const profile = parsed.profile as Record<string, unknown>;
    const collections = [
      'contact_points',
      'statements',
      'competency_examples',
      'experiences',
      'projects',
      'education',
      'courses',
      'skills',
      'skill_usages',
      'languages',
      'certifications',
      'awards',
      'publications',
      'volunteering',
      'evidence',
      'pending_items',
    ];
    for (const key of collections) expect(profile[key], key).toEqual([]);
    expect((profile.usage_rules as { restrictions: unknown[] }).restrictions).toEqual([]);
    const keys = listContractPaths()
      .filter((path) => path.includes('[]'))
      .map((path) => (path.split('.').pop() ?? '').replace('[]', ''));
    for (const key of new Set(keys)) {
      expect(text, `campo ${key}`).toMatch(new RegExp(`(^|\\s|#)${key}:`, 'm'));
    }
  });

  it('explica ausencia, estados explicitos e privacidade no cabecalho', () => {
    expect(text).toContain('ZERO registros');
    expect(text).toContain('needs_review');
    expect(text).toContain('not_applicable');
    expect(text).toContain('NÃO é registrado neste arquivo');
  });
});

describe('fixtures v2 sao validas', () => {
  it.each([
    ['completa', v2CompleteYaml],
    ['parcial', v2PartialYaml],
  ])('perfil %s valida no contrato', (_name, read) => {
    const result = loadProfile(read());
    expect(result.report.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(() => parseProfileDocument(result.document)).not.toThrow();
  });
});

/** Round-trip em nivel de documento: parse -> normalizar -> serializar -> parse (A§12.4, parcial). */
describe('round-trip estavel (parse -> normalizar -> serializar -> parse)', () => {
  const sources: [string, () => string][] = [
    ['template v2 (vazio)', v2TemplateYaml],
    ['perfil v2 completo', v2CompleteYaml],
    ['perfil v2 parcial', v2PartialYaml],
    ['template 1.0.0 migrado', legacyTemplateYaml],
    ['1.0.0 preenchido migrado', legacyFilledYaml],
  ];

  it.each(sources)('%s: YAML e JSON sao estaveis e equivalentes', (_name, read) => {
    const first = loadProfile(read(), { mode: 'lenient' });
    expect(first.ok).toBe(true);
    const doc = first.document!;

    const yaml1 = serializeProfile(doc, 'yaml');
    const second = loadProfile(yaml1);
    expect(second.ok).toBe(true);
    expect(second.document).toEqual(doc);
    expect(serializeProfile(second.document!, 'yaml')).toBe(yaml1);

    const json1 = serializeProfile(doc, 'json');
    const third = loadProfile(json1);
    expect(third.ok).toBe(true);
    expect(third.document).toEqual(doc);
    expect(serializeProfile(third.document!, 'json')).toBe(json1);

    // YAML e JSON descrevem o mesmo dado
    expect(JSON.parse(json1)).toEqual(
      parseProfileText(yaml1).ok ? (parseProfileText(yaml1) as { data: unknown }).data : null,
    );
    // a forma canonica e ponto fixo
    expect(canonicalizeProfileDocument(doc)).toEqual(doc);
  });

  it('YAML serializado: datas e versoes entre aspas, chaves na ordem do contrato, LF, sem nulls', () => {
    const doc = loadProfile(v2CompleteYaml()).document!;
    const yaml = serializeProfile(doc);
    expect(yaml.startsWith('schema_version: "2.1.0"\n')).toBe(true);
    expect(yaml).toMatch(/start_date: "2021-03"/);
    expect(yaml).toMatch(/completion_date: "2016-12"/);
    expect(yaml).not.toContain('\r');
    expect(yaml).not.toMatch(/: null$/m);
    expect(yaml.indexOf('identity:')).toBeLessThan(yaml.indexOf('experiences:'));
    expect(yaml.indexOf('experiences:')).toBeLessThan(yaml.indexOf('skills:'));
    expect(serializeProfile(doc, 'json').endsWith('\n')).toBe(true);
  });

  it('textos com caracteres especiais sobrevivem ao round-trip (aspas, dois-pontos, #, acentos, quebras de linha)', () => {
    const tricky = 'Linha 1: "aspas" # nao-comentario\n  - parece lista\nAção — 100% ✓';
    const doc = parseProfileDocument({
      schema_version: '2.1.0',
      profile: {
        statements: [{ kind: 'full_summary', text: tricky }],
        identity: { full_name: 'null', city: 'true', region: '123', timezone: 'UTC-3' },
        skills: [{ name: 'yes' }, { name: '~' }, { name: '2020-05-01' }],
      },
    });
    for (const format of ['yaml', 'json'] as const) {
      const again = loadProfile(serializeProfile(doc, format));
      expect(again.ok, format).toBe(true);
      expect(again.document).toEqual(doc);
    }
  });
});
