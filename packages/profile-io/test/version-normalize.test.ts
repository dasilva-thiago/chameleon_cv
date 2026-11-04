import { describe, expect, it } from 'vitest';
import type { ProfileDocument } from '@chameleon/contracts';
import {
  detectSchemaVersion,
  isEmptyRecord,
  normalizeProfileData,
  ReportBuilder,
  validateProfile,
} from '../src/index';

describe('detectSchemaVersion', () => {
  it('versoes suportadas', () => {
    expect(detectSchemaVersion({ schema_version: '2.1.0' })).toEqual({
      kind: 'current',
      version: '2.1.0',
    });
    expect(detectSchemaVersion({ schema_version: '2.0.0' })).toEqual({
      kind: 'previous',
      version: '2.0.0',
    });
    expect(detectSchemaVersion({ schema_version: '1.0.0' })).toEqual({
      kind: 'legacy',
      version: '1.0.0',
    });
  });

  it('versao ausente, nula, nao textual ou raiz invalida geram erro claro (nunca adivinha)', () => {
    expect(detectSchemaVersion({}).kind).toBe('missing');
    expect(detectSchemaVersion({ schema_version: null }).kind).toBe('missing');
    expect(detectSchemaVersion({ schema_version: 2 }).kind).toBe('invalid');
    expect(detectSchemaVersion({ schema_version: ['2.0.0'] }).kind).toBe('invalid');
    expect(detectSchemaVersion(null).kind).toBe('invalid');
    expect(detectSchemaVersion([]).kind).toBe('invalid');
    expect(detectSchemaVersion('2.0.0').kind).toBe('invalid');
  });

  it('versao futura x desconhecida', () => {
    for (const future of ['2.1.1', '2.2.0', '3.0.0', '10.2.3']) {
      expect(detectSchemaVersion({ schema_version: future }).kind, future).toBe('future');
    }
    for (const unknown of [
      '2.0.1',
      '2.0.5',
      '0.9.0',
      '9.9.9-beta',
      '1.0',
      '1.1.0',
      'v2',
      '',
      '2.0.0 ',
      'latest',
    ]) {
      const kind = detectSchemaVersion({ schema_version: unknown }).kind;
      expect(['unsupported', 'future'], unknown).toContain(kind);
    }
    expect(detectSchemaVersion({ schema_version: '0.9.0' }).kind).toBe('unsupported');
    expect(detectSchemaVersion({ schema_version: '1.1.0' }).kind).toBe('unsupported');
    expect(detectSchemaVersion({ schema_version: '9.9.9' }).kind).toBe('future');
    expect(detectSchemaVersion({ schema_version: '2.0.0 ' }).kind).toBe('unsupported');
  });
});

describe('isEmptyRecord', () => {
  it('ignora id, meta e discriminadores; booleanos e numeros sao conteudo', () => {
    expect(
      isEmptyRecord('experience', {
        id: 'E',
        meta: { status: 'confirmed' },
        organization_name: null,
        items: [],
      }),
    ).toBe(true);
    expect(isEmptyRecord('experience', { organization_name: '  ' })).toBe(true);
    expect(isEmptyRecord('experience', { organization_name: 'X' })).toBe(false);
    expect(isEmptyRecord('experience', { location: { city: null, region: '' } })).toBe(true);
    expect(isEmptyRecord('project', { team_based: false })).toBe(false);
    expect(isEmptyRecord('course', { workload_hours: 0 })).toBe(false);
    expect(isEmptyRecord('evidence', { type: 'repository' })).toBe(true);
    expect(isEmptyRecord('evidence', { type: 'repository', title: 'x' })).toBe(false);
    expect(isEmptyRecord('statement', { kind: 'value', text: '' })).toBe(true);
    expect(isEmptyRecord('skill_usage', { skill_id: 'S', usage_context: 'unverified' })).toBe(
      false,
    );
  });
});

describe('normalizeProfileData', () => {
  const run = (input: unknown) => {
    const report = new ReportBuilder();
    const result = normalizeProfileData(input, report);
    return { result, report, codes: report.warnings.map((w) => w.code) };
  };

  it('"" vira null e gera EMPTY_STRING_NORMALIZED agregado por objeto', () => {
    const { result, report, codes } = run({
      schema_version: '2.1.0',
      profile: { identity: { full_name: 'Ana', city: '', region: '   ', pronouns: '\n' } },
    });
    expect((result.data as ProfileDocument).profile.identity).toEqual({
      full_name: 'Ana',
      city: null,
      region: null,
      pronouns: null,
    });
    expect(codes).toEqual(['EMPTY_STRING_NORMALIZED']);
    expect(report.warnings[0]?.path).toBe('profile.identity');
    expect(report.warnings[0]?.message).toContain('3 campo(s)');
    expect(result.emptyStrings).toBe(3);
  });

  it('descarta registros fantasma (EMPTY_RECORD_DROPPED), inclusive sub-registros, sem tocar nos demais', () => {
    const { result, codes } = run({
      schema_version: '2.1.0',
      profile: {
        experiences: [
          { id: 'E0', organization_name: '', meta: { status: 'confirmed' }, items: [] },
          {
            id: 'E1',
            organization_name: 'Org',
            items: [
              { kind: 'responsibility', text: '' },
              { kind: 'responsibility', text: 'faz algo' },
            ],
          },
          { id: 'E2', organization_name: null },
        ],
        skills: [{ name: '' }, { name: 'Python' }],
      },
    });
    const profile = (result.data as ProfileDocument).profile;
    expect(profile.experiences?.map((e) => e.id)).toEqual(['E1']);
    expect(profile.experiences?.[0]?.items).toEqual([{ kind: 'responsibility', text: 'faz algo' }]);
    expect(profile.skills).toEqual([{ name: 'Python' }]);
    expect(codes.filter((c) => c === 'EMPTY_RECORD_DROPPED')).toHaveLength(4);
    expect(result.droppedRecords).toBe(4);
  });

  it('remove itens vazios de listas de texto (EMPTY_LIST_ITEM_DROPPED) e preserva []', () => {
    const { result, codes } = run({
      schema_version: '2.1.0',
      profile: {
        identity: {
          countries_of_work_interest: ['Brasil', '', '  ', 'Portugal'],
          interface_languages: [],
        },
      },
    });
    expect((result.data as ProfileDocument).profile.identity).toEqual({
      countries_of_work_interest: ['Brasil', 'Portugal'],
      interface_languages: [],
    });
    expect(codes).toContain('EMPTY_LIST_ITEM_DROPPED');
  });

  it('normaliza texto (espacos, NFC, controle) sem alterar o conteudo significativo', () => {
    const { result } = run({
      schema_version: '2.1.0',
      profile: {
        identity: { full_name: '  Ana\u0000  Maria  ' },
        statements: [{ kind: 'full_summary', text: 'Linha 1  \r\n\r\n\r\n\r\nLinha 2' }],
      },
    });
    const profile = (result.data as ProfileDocument).profile;
    expect(profile.identity?.full_name).toBe('Ana Maria');
    expect(profile.statements?.[0]?.text).toBe('Linha 1\n\nLinha 2');
  });

  it('nao muda numeros, booleanos, null nem a ordem dos itens; nao altera a entrada', () => {
    const input = {
      schema_version: '2.1.0',
      profile: {
        courses: [
          { name: 'B', workload_hours: 0 },
          { name: 'A', certificate_issued: false },
        ],
      },
    };
    const snapshot: unknown = JSON.parse(JSON.stringify(input));
    const { result } = run(input);
    expect(input).toEqual(snapshot);
    expect((result.data as ProfileDocument).profile.courses).toEqual(input.profile.courses);
  });

  it('descarta chaves proibidas (nao as propaga)', () => {
    const polluted: unknown = JSON.parse(
      '{"schema_version":"2.0.0","profile":{"__proto__":{"x":1},"identity":{"full_name":"A"}}}',
    );
    const { result, codes } = run(polluted);
    expect(Object.keys((result.data as ProfileDocument).profile)).toEqual(['identity']);
    expect(codes).toContain('UNKNOWN_KEY_UNMAPPED');
  });

  it('entradas que nao sao objeto passam sem erro', () => {
    expect(run(null).result.data).toBeNull();
    expect(run('x').result.data).toBe('x');
  });

  it('idempotente: normalizar duas vezes da o mesmo resultado e nenhum aviso novo', () => {
    const input = {
      schema_version: '2.1.0',
      profile: {
        identity: { city: '' },
        experiences: [{ id: 'X' }, { organization_name: ' A  B ' }],
      },
    };
    const first = run(input);
    const second = run(first.result.data);
    expect(second.result.data).toEqual(first.result.data);
    expect(second.report.warnings).toEqual([]);
  });
});

describe('validateProfile (strict e lenient)', () => {
  it('strict: chave desconhecida e erro', () => {
    const result = validateProfile({ schema_version: '2.1.0', profile: { typo: 1 } });
    expect(result.ok).toBe(false);
  });

  it('lenient: chave desconhecida vira aviso, valor preservado em unmapped, demais erros continuam erros', () => {
    const report = new ReportBuilder();
    const ok = validateProfile(
      {
        schema_version: '2.1.0',
        profile: {
          typo_section: { a: 1 },
          experiences: [{ organization_name: 'X', extra: [1, 2] }],
        },
      },
      'lenient',
      report,
    );
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.document.profile).toEqual({ experiences: [{ organization_name: 'X' }] });
    expect(report.unmapped).toHaveLength(2);
    expect(report.unmapped).toEqual(
      expect.arrayContaining([
        { path: 'profile.typo_section', value: { a: 1 }, reason: expect.any(String) as unknown },
        {
          path: 'profile.experiences[0].extra',
          value: [1, 2],
          reason: expect.any(String) as unknown,
        },
      ]),
    );
    expect(report.warnings.filter((w) => w.code === 'UNKNOWN_KEY_UNMAPPED')).toHaveLength(2);

    const bad = validateProfile(
      {
        schema_version: '2.1.0',
        profile: { typo: 1, experiences: [{ employment_type: 'banana' }] },
      },
      'lenient',
      new ReportBuilder(),
    );
    expect(bad.ok).toBe(false);
  });

  it('lenient nao corrige entrada: nao altera o objeto recebido', () => {
    const input = { schema_version: '2.1.0', profile: { typo: 1 } };
    validateProfile(input, 'lenient', new ReportBuilder());
    expect(input.profile).toEqual({ typo: 1 });
  });
});
