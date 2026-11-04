import { describe, expect, it } from 'vitest';
import {
  FACT_KINDS,
  isSupportedSchemaVersion,
  SUPPORTED_SCHEMA_VERSIONS,
  PROFILE_SCHEMA_VERSION,
  ProfileValidationError,
  parseProfileDocument,
  profileDocumentSchema,
  safeParseProfileDocument,
} from '../src/index';
import { doc, isValid, issuesOf, referenceProfile } from './helpers';

describe('constantes e API publica', () => {
  it('expoe a versao 2.0.0 e as versoes suportadas', () => {
    expect(PROFILE_SCHEMA_VERSION).toBe('2.1.0');
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual(['1.0.0', '2.0.0', '2.1.0']);
    expect(isSupportedSchemaVersion('2.0.0')).toBe(true);
    expect(isSupportedSchemaVersion('1.0.0')).toBe(true);
    expect(isSupportedSchemaVersion('9.9.9')).toBe(false);
    expect(isSupportedSchemaVersion(2)).toBe(false);
  });

  it('parseProfileDocument devolve o documento ou lanca ProfileValidationError com todos os problemas', () => {
    const valid = doc({ identity: { full_name: 'Ana' } });
    expect(parseProfileDocument(valid)).toEqual(valid);

    const invalid = doc({ experiences: [{ employment_type: 'x' }], typo: 1 });
    try {
      parseProfileDocument(invalid);
      expect.unreachable('deveria lancar');
    } catch (error) {
      expect(error).toBeInstanceOf(ProfileValidationError);
      const { issues } = error as ProfileValidationError;
      expect(issues.length).toBeGreaterThanOrEqual(2);
      expect(
        issues.some((issue) => issue.code === 'unrecognized_keys' && issue.keys?.includes('typo')),
      ).toBe(true);
    }
  });

  it('nao aplica defaults nem transforma o documento (sem defaults que parecam fatos)', () => {
    const input = doc({ experiences: [{ organization_name: 'X' }], skills: [{ name: 'Y' }] });
    const result = safeParseProfileDocument(input);
    expect(result.success && result.data).toEqual(input);
    const parsed = profileDocumentSchema.parse(input);
    const experience = parsed.profile.experiences?.[0];
    expect(experience).toEqual({ organization_name: 'X' });
    expect(experience?.meta).toBeUndefined();
  });
});

describe('estrutura raiz', () => {
  it('perfil vazio e valido; profile e obrigatorio; schema_version e obrigatorio', () => {
    expect(isValid(doc({}))).toBe(true);
    expect(isValid({ schema_version: '2.0.0' })).toBe(false);
    expect(isValid({ profile: {} })).toBe(false);
    expect(isValid({ schema_version: '2.0.0', profile: null })).toBe(false);
    expect(isValid(null)).toBe(false);
    expect(isValid([])).toBe(false);
    expect(isValid('texto')).toBe(false);
  });

  it('rejeita versao diferente e chaves desconhecidas na raiz', () => {
    expect(isValid({ schema_version: '1.0.0', profile: {} })).toBe(false);
    expect(isValid({ schema_version: '2.0.1', profile: {} })).toBe(false);
    expect(isValid({ schema_version: 2, profile: {} })).toBe(false);
    expect(isValid(doc({}, { extra: true }))).toBe(false);
  });

  it('locale: BCP-47 ou ausente/null', () => {
    expect(isValid(doc({}, { locale: 'pt-BR' }))).toBe(true);
    expect(isValid(doc({}, { locale: 'en' }))).toBe(true);
    expect(isValid(doc({}, { locale: null }))).toBe(true);
    expect(isValid(doc({}, { locale: 'portugues brasileiro' }))).toBe(false);
    expect(isValid(doc({}, { locale: '' }))).toBe(false);
  });

  it('todas as secoes aceitam null e [] (ausencia != lista vazia, ambas validas)', () => {
    expect(
      isValid(
        doc({
          identity: null,
          contact_points: null,
          experiences: [],
          projects: null,
          skills: [],
          availability_preferences: null,
          usage_rules: { restrictions: [] },
        }),
      ),
    ).toBe(true);
  });
});

describe('perfil parcial', () => {
  it('aceita registros com apenas um campo e sem ids', () => {
    expect(
      isValid(
        doc({
          identity: { full_name: 'Ana' },
          experiences: [{ organization_name: 'Org' }],
          education: [{ institution: 'Escola' }],
          skills: [{ name: 'Atendimento' }],
          languages: [{ language: 'Espanhol' }],
        }),
      ),
    ).toBe(true);
  });

  it('nenhum campo, enum ou default e especifico de uma profissao: profissoes variadas validam', () => {
    expect(
      isValid(
        doc({
          positioning: { current_profession: 'Enfermagem', current_seniority: 'senior' },
          skills: [
            { id: 'S1', name: 'Ventilação mecânica', category: 'domain' },
            { id: 'S2', name: 'Soldagem TIG', category: 'method' },
            { id: 'S3', name: 'Direito trabalhista', category: 'domain' },
          ],
          skill_usages: [
            {
              skill_id: 'S1',
              usage_context: 'self_declared_knowledge',
              facet: 'terapia intensiva',
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe('texto, ausencia e normalizacao esperada', () => {
  it('rejeita "" e texto so com espacos (o importador converte para null)', () => {
    expect(isValid(doc({ identity: { city: '' } }))).toBe(false);
    expect(isValid(doc({ identity: { city: '   ' } }))).toBe(false);
    expect(isValid(doc({ identity: { city: '\n\t' } }))).toBe(false);
    expect(isValid(doc({ identity: { city: null } }))).toBe(true);
    expect(isValid(doc({ identity: { countries_of_work_interest: [''] } }))).toBe(false);
  });

  it('nao permite NUL e respeita limites de tamanho', () => {
    expect(isValid(doc({ identity: { city: 'a\u0000b' } }))).toBe(false);
    expect(isValid(doc({ identity: { city: 'x'.repeat(200) } }))).toBe(true);
    expect(isValid(doc({ identity: { city: 'x'.repeat(201) } }))).toBe(false);
    expect(isValid(doc({ statements: [{ kind: 'full_summary', text: 'x'.repeat(10_000) }] }))).toBe(
      true,
    );
    expect(isValid(doc({ statements: [{ kind: 'full_summary', text: 'x'.repeat(10_001) }] }))).toBe(
      false,
    );
    expect(
      isValid(doc({ skills: Array.from({ length: 501 }, (_, i) => ({ name: `s${i}` })) })),
    ).toBe(false);
  });

  it('tipos errados sao rejeitados', () => {
    expect(isValid(doc({ identity: { city: 5 } }))).toBe(false);
    expect(isValid(doc({ experiences: 'x' }))).toBe(false);
    expect(isValid(doc({ experiences: [null] }))).toBe(false);
    expect(isValid(doc({ experiences: [{ organization_name: 'X', items: [{}] }] }))).toBe(false);
    expect(isValid(doc({ projects: [{ name: 'P', team_based: 'sim' }] }))).toBe(false);
  });
});

describe('datas parciais e periodos', () => {
  const experience = (extra: Record<string, unknown>) =>
    doc({ experiences: [{ organization_name: 'X', ...extra }] });

  it.each(['2020', '2020-03', '2020-03-15', '2024-02-29'])('aceita %s', (date) => {
    expect(isValid(experience({ start_date: date }))).toBe(true);
  });

  it.each([
    '20',
    '2020-13',
    '2020-00',
    '2020-02-30',
    '2023-02-29',
    '2020-3',
    '2020-03-1',
    '03/2020',
    '2020-03-15T00:00:00Z',
    'ontem',
    '0000',
    20,
  ])('rejeita %s', (date) => {
    expect(isValid(experience({ start_date: date }))).toBe(false);
  });

  it('end_date aceita "present" e null; start_date NAO aceita "present"', () => {
    expect(isValid(experience({ start_date: '2020', end_date: 'present' }))).toBe(true);
    expect(isValid(experience({ start_date: '2020', end_date: null }))).toBe(true);
    expect(isValid(experience({ start_date: 'present' }))).toBe(false);
    expect(isValid(doc({ education: [{ institution: 'E', completion_date: 'present' }] }))).toBe(
      false,
    );
    expect(isValid(doc({ certifications: [{ name: 'C', issue_date: 'present' }] }))).toBe(false);
  });

  it('fim definitivamente anterior ao inicio e erro; imprecisao ambigua nao e', () => {
    expect(isValid(experience({ start_date: '2021', end_date: '2019-05' }))).toBe(false);
    expect(isValid(experience({ start_date: '2020-05', end_date: '2020-04' }))).toBe(false);
    expect(isValid(experience({ start_date: '2020-05-10', end_date: '2020-05-09' }))).toBe(false);
    expect(isValid(experience({ start_date: '2020-05', end_date: '2020' }))).toBe(true);
    expect(isValid(experience({ start_date: '2020', end_date: '2020-01' }))).toBe(true);
    expect(isValid(experience({ start_date: '2020-05', end_date: '2020-05' }))).toBe(true);
  });

  it('regras de periodo tambem valem para projetos, formacao, cursos, certificacoes e voluntariado', () => {
    expect(isValid(doc({ projects: [{ name: 'P', start_date: '2022', end_date: '2020' }] }))).toBe(
      false,
    );
    expect(
      isValid(
        doc({ education: [{ institution: 'E', start_date: '2022', completion_date: '2020' }] }),
      ),
    ).toBe(false);
    expect(
      isValid(doc({ courses: [{ name: 'C', start_date: '2022-05', completion_date: '2022-04' }] })),
    ).toBe(false);
    expect(
      isValid(
        doc({ certifications: [{ name: 'C', issue_date: '2022', expiration_date: '2020' }] }),
      ),
    ).toBe(false);
    expect(
      isValid(doc({ volunteering: [{ organization: 'O', start_date: '2022', end_date: '2021' }] })),
    ).toBe(false);
    expect(
      isValid(
        doc({
          skills: [{ id: 'S', name: 'x' }],
          skill_usages: [
            { skill_id: 'S', usage_context: 'unverified', start_date: '2022', end_date: '2020' },
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe('URLs, e-mails, telefones, moeda, locale e DOI', () => {
  const project = (extra: Record<string, unknown>) => doc({ projects: [{ name: 'P', ...extra }] });

  it('URLs: somente http(s), sem credenciais, sem esquemas perigosos', () => {
    expect(isValid(project({ public_url: 'https://exemplo.test/x?y=1#z' }))).toBe(true);
    expect(isValid(project({ public_url: 'http://exemplo.test' }))).toBe(true);
    for (const bad of [
      'ftp://exemplo.test',
      'javascript:alert(1)',
      'data:text/html,hi',
      'exemplo.test',
      'https://',
      'https://user:pass@exemplo.test',
      ' https://exemplo.test',
      'file:///etc/passwd',
    ]) {
      expect(isValid(project({ public_url: bad })), bad).toBe(false);
    }
    expect(isValid(project({ public_url: `https://exemplo.test/${'a'.repeat(2048)}` }))).toBe(
      false,
    );
  });

  it('contatos validam o valor conforme o tipo e o subtipo conforme o tipo', () => {
    expect(
      isValid(
        doc({
          contact_points: [{ kind: 'email', value: 'a@exemplo.test', subtype: 'professional' }],
        }),
      ),
    ).toBe(true);
    expect(isValid(doc({ contact_points: [{ kind: 'email', value: 'a@b' }] }))).toBe(false);
    expect(isValid(doc({ contact_points: [{ kind: 'email', value: 'https://x.test' }] }))).toBe(
      false,
    );
    expect(
      isValid(doc({ contact_points: [{ kind: 'phone', value: '+55 (11) 91234-5678' }] })),
    ).toBe(true);
    expect(isValid(doc({ contact_points: [{ kind: 'phone', value: '123' }] }))).toBe(false);
    expect(isValid(doc({ contact_points: [{ kind: 'phone', value: 'ligue-me' }] }))).toBe(false);
    expect(
      isValid(
        doc({
          contact_points: [{ kind: 'link', value: 'https://github.com/x', subtype: 'github' }],
        }),
      ),
    ).toBe(true);
    expect(isValid(doc({ contact_points: [{ kind: 'link', value: 'x@y.com' }] }))).toBe(false);
    expect(
      isValid(
        doc({ contact_points: [{ kind: 'email', value: 'a@exemplo.test', subtype: 'github' }] }),
      ),
    ).toBe(false);
    expect(
      isValid(
        doc({ contact_points: [{ kind: 'phone', value: '+5511912345678', subtype: 'linkedin' }] }),
      ),
    ).toBe(false);
    expect(isValid(doc({ contact_points: [{ kind: 'email' }] }))).toBe(false);
    expect(isValid(doc({ contact_points: [{ value: 'a@exemplo.test' }] }))).toBe(false);
  });

  it('moeda ISO, locale, fuso, DOI', () => {
    expect(
      isValid(
        doc({ availability_preferences: { salary_expectation: { amount: 0, currency: 'BRL' } } }),
      ),
    ).toBe(true);
    expect(
      isValid(
        doc({
          availability_preferences: { salary_expectation: { amount: 1000.5, currency: 'brl' } },
        }),
      ),
    ).toBe(false);
    expect(
      isValid(doc({ availability_preferences: { salary_expectation: { amount: Number.NaN } } })),
    ).toBe(false);
    expect(
      isValid(
        doc({
          availability_preferences: { salary_expectation: { amount: Number.POSITIVE_INFINITY } },
        }),
      ),
    ).toBe(false);
    expect(isValid(doc({ identity: { timezone: 'America/Sao_Paulo' } }))).toBe(true);
    expect(isValid(doc({ identity: { timezone: 'meio dia' } }))).toBe(false);
    expect(isValid(doc({ identity: { interface_languages: ['pt-BR', 'en'] } }))).toBe(true);
    expect(isValid(doc({ identity: { interface_languages: ['portugues'] } }))).toBe(false);
    expect(isValid(doc({ publications: [{ title: 'T', doi: '10.1234/abc.def' }] }))).toBe(true);
    expect(isValid(doc({ publications: [{ title: 'T', doi: 'doi:10.1234/abc' }] }))).toBe(false);
    expect(isValid(doc({ publications: [{ title: 'T', url: 'ver pasta' }] }))).toBe(false);
  });

  it('evidence.url_or_location: texto livre ou URL http(s) valida', () => {
    expect(
      isValid(
        doc({ evidence: [{ type: 'document', url_or_location: 'Pasta física no escritório' }] }),
      ),
    ).toBe(true);
    expect(
      isValid(
        doc({ evidence: [{ type: 'portfolio', url_or_location: 'https://exemplo.test/p' }] }),
      ),
    ).toBe(true);
    expect(
      isValid(doc({ evidence: [{ type: 'portfolio', url_or_location: 'javascript:alert(1)' }] })),
    ).toBe(false);
    expect(
      isValid(doc({ evidence: [{ type: 'portfolio', url_or_location: 'ftp://x.test' }] })),
    ).toBe(false);
  });
});

describe('enums estritos', () => {
  it('rejeita valores fora do vocabulario e aceita os canonicos', () => {
    const cases: [string, Record<string, unknown>, string, boolean][] = [
      ['experiences', { organization_name: 'X' }, 'employment_type', true],
      ['projects', { name: 'P' }, 'category', true],
      ['education', { institution: 'E' }, 'degree_type', true],
      ['courses', { name: 'C' }, 'status', true],
      ['skills', { name: 'S' }, 'self_assessed_level', true],
      ['languages', { language: 'L' }, 'overall_level', true],
      ['certifications', { name: 'C' }, 'status', true],
      ['awards', { name: 'A' }, 'scope', true],
      ['publications', { title: 'T' }, 'type', true],
      ['volunteering', { organization: 'O' }, 'participation_type', true],
    ];
    const valid: Record<string, string> = {
      employment_type: 'freelance',
      category: 'open_source',
      degree_type: 'masters',
      status: 'completed',
      self_assessed_level: 'expert',
      overall_level: 'C1',
      scope: 'international',
      type: 'thesis',
      participation_type: 'mentoring',
    };
    for (const [collection, base, field] of cases) {
      const goodValue =
        field === 'status' && collection === 'certifications' ? 'valid' : valid[field];
      expect(
        isValid(doc({ [collection]: [{ ...base, [field]: goodValue }] })),
        `${collection}.${field}`,
      ).toBe(true);
      expect(
        isValid(doc({ [collection]: [{ ...base, [field]: 'banana' }] })),
        `${collection}.${field}=banana`,
      ).toBe(false);
      expect(
        isValid(doc({ [collection]: [{ ...base, [field]: '' }] })),
        `${collection}.${field}=""`,
      ).toBe(false);
    }
  });

  it('valores legados do 1.0.0 nao sao aceitos no 2.0.0 (apprentice, ignored, professional...)', () => {
    expect(
      isValid(doc({ experiences: [{ organization_name: 'X', employment_type: 'apprentice' }] })),
    ).toBe(false);
    expect(isValid(doc({ pending_items: [{ subject: 'S', status: 'ignored' }] }))).toBe(false);
    expect(
      isValid(
        doc({
          skills: [{ id: 'S', name: 'x' }],
          skill_usages: [{ skill_id: 'S', usage_context: 'professional' }],
        }),
      ),
    ).toBe(false);
    expect(isValid(doc({ resume_preferences: { include_photo: false } }))).toBe(false);
  });
});

describe('meta, estados explicitos e governanca', () => {
  const exp = (extra: Record<string, unknown>) =>
    doc({ experiences: [{ organization_name: 'X', ...extra }] });

  it('meta e opcional e sem defaults; aceita todos os campos canonicos', () => {
    expect(isValid(exp({}))).toBe(true);
    expect(
      isValid(
        exp({
          meta: {
            status: 'needs_review',
            declared_status: 'confirmed',
            visibility: 'conditional',
            resume_use: 'requires_approval',
            source: 'resume_import',
            source_detail: 'curriculo.docx p.1',
            source_excerpt: 'trecho original',
            evidence_ids: [],
            field_states: { department: 'needs_confirmation' },
            private_notes: 'nota privada',
          },
        }),
      ),
    ).toBe(true);
    expect(isValid(exp({ meta: { unknown_flag: true } }))).toBe(false);
    expect(isValid(exp({ meta: { visibility: 'secret' } }))).toBe(false);
    expect(isValid(exp({ meta: { resume_use: 'sempre' } }))).toBe(false);
    expect(isValid(exp({ meta: { source: 'telepatia' } }))).toBe(false);
  });

  it('field_states: os cinco estados sao aceitos; chave deve ser campo do registro', () => {
    for (const state of [
      'not_provided',
      'not_applicable',
      'not_assessed',
      'declined',
      'needs_confirmation',
    ]) {
      expect(isValid(exp({ meta: { field_states: { department: state } } })), state).toBe(true);
    }
    expect(isValid(exp({ meta: { field_states: { department: 'maybe' } } }))).toBe(false);
    expect(isValid(exp({ meta: { field_states: { campo_inexistente: 'declined' } } }))).toBe(false);
    expect(isValid(exp({ meta: { field_states: { id: 'declined' } } }))).toBe(false);
  });

  it('field_states que negam o valor conflitam com valor preenchido; needs_confirmation convive com valor', () => {
    expect(
      isValid(
        exp({ department: 'Operações', meta: { field_states: { department: 'not_applicable' } } }),
      ),
    ).toBe(false);
    expect(
      isValid(exp({ department: 'Operações', meta: { field_states: { department: 'declined' } } })),
    ).toBe(false);
    expect(
      isValid(
        exp({ department: 'Operações', meta: { field_states: { department: 'not_provided' } } }),
      ),
    ).toBe(false);
    expect(
      isValid(
        exp({
          department: 'Operações',
          meta: { field_states: { department: 'needs_confirmation' } },
        }),
      ),
    ).toBe(true);
    expect(
      isValid(exp({ department: null, meta: { field_states: { department: 'declined' } } })),
    ).toBe(true);
    expect(
      isValid(
        exp({ team_interfaces: [], meta: { field_states: { team_interfaces: 'not_applicable' } } }),
      ),
    ).toBe(true);
  });

  it('blocos singleton tambem tem field_states', () => {
    expect(
      isValid(
        doc({ availability_preferences: { field_states: { salary_expectation: 'declined' } } }),
      ),
    ).toBe(true);
    expect(
      isValid(
        doc({
          availability_preferences: {
            salary_expectation: { amount: 10 },
            field_states: { salary_expectation: 'declined' },
          },
        }),
      ),
    ).toBe(false);
    expect(isValid(doc({ identity: { field_states: { cpf: 'declined' } } }))).toBe(false);
  });

  it('registro sem conteudo (so id/meta/discriminador) e rejeitado', () => {
    expect(isValid(doc({ experiences: [{}] }))).toBe(false);
    expect(isValid(doc({ experiences: [{ id: 'EXP-1' }] }))).toBe(false);
    expect(isValid(doc({ experiences: [{ id: 'EXP-1', meta: { status: 'confirmed' } }] }))).toBe(
      false,
    );
    expect(isValid(doc({ experiences: [{ organization_name: null, official_title: null }] }))).toBe(
      false,
    );
    expect(isValid(doc({ experiences: [{ team_interfaces: [] }] }))).toBe(false);
    expect(isValid(doc({ evidence: [{ type: 'other' }] }))).toBe(false);
    expect(isValid(doc({ statements: [{ kind: 'value' }] }))).toBe(false);
    expect(isValid(doc({ pending_items: [{ priority: 'high', status: 'open' }] }))).toBe(false);
    // false e 0 sao valores explicitos, nao ausencia
    expect(isValid(doc({ projects: [{ team_based: false }] }))).toBe(true);
    expect(isValid(doc({ courses: [{ workload_hours: 0 }] }))).toBe(true);
  });

  it('todo tipo de fato carrega meta (FactKind do ADR-0006)', () => {
    expect(FACT_KINDS.length).toBe(15);
  });
});

describe('integridade referencial', () => {
  const withProfile = (extra: Record<string, unknown>) => doc({ ...referenceProfile(), ...extra });

  it('perfil de referencia e valido', () => {
    expect(isValid(withProfile({}))).toBe(true);
  });

  it('ids sao unicos em TODO o documento (colecoes diferentes, sub-itens, colaboradores)', () => {
    expect(
      isValid(
        doc({
          experiences: [{ id: 'X', organization_name: 'A' }],
          projects: [{ id: 'X', name: 'P' }],
        }),
      ),
    ).toBe(false);
    expect(
      isValid(
        doc({
          experiences: [
            {
              id: 'E',
              organization_name: 'A',
              items: [{ id: 'E', kind: 'responsibility', text: 't' }],
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isValid(
        doc({
          projects: [
            { id: 'P1', name: 'P', collaborators: [{ id: 'C', name_or_role: 'x' }] },
            { id: 'P2', name: 'Q', collaborators: [{ id: 'C', name_or_role: 'y' }] },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isValid(
        doc({
          experiences: [
            { id: 'A', organization_name: 'a' },
            { id: 'a', organization_name: 'b' },
          ],
        }),
      ),
    ).toBe(true); // ids diferenciam caixa
  });

  it('formato de id', () => {
    for (const bad of ['', ' ', 'com espaco', '-inicio', 'a/b', 'x'.repeat(65)]) {
      expect(isValid(doc({ experiences: [{ id: bad, organization_name: 'A' }] })), bad).toBe(false);
    }
    expect(
      isValid(
        doc({
          experiences: [{ id: '0190a2c1-7b3e-7f00-8000-000000000001', organization_name: 'A' }],
        }),
      ),
    ).toBe(true);
    expect(isValid(doc({ experiences: [{ id: 'EXP_001.v2:a', organization_name: 'A' }] }))).toBe(
      true,
    );
  });

  it('meta.evidence_ids deve resolver para evidence[] e nao para outro tipo de registro', () => {
    expect(
      isValid(
        withProfile({
          education: [{ id: 'EDU-2', institution: 'X', meta: { evidence_ids: ['EVD-1'] } }],
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({
          education: [{ id: 'EDU-2', institution: 'X', meta: { evidence_ids: ['EXP-1'] } }],
        }),
      ),
    ).toBe(false);
    expect(
      isValid(
        withProfile({
          education: [{ id: 'EDU-2', institution: 'X', meta: { evidence_ids: ['EVD-9'] } }],
        }),
      ),
    ).toBe(false);
  });

  it('evidence.supports aponta para fatos', () => {
    const base = referenceProfile();
    const evidence = [{ id: 'EVD-1', type: 'document', supports: ['EXP-1', 'SKL-1'] }];
    expect(isValid(doc({ ...base, evidence }))).toBe(true);
    expect(
      isValid(doc({ ...base, evidence: [{ id: 'EVD-1', type: 'document', supports: ['EVD-1'] }] })),
    ).toBe(false);
    expect(
      isValid(doc({ ...base, evidence: [{ id: 'EVD-1', type: 'document', supports: ['NADA'] }] })),
    ).toBe(false);
  });

  it('referencias de projeto, competencia, idioma, exemplo de competencia e preferencias de curriculo', () => {
    expect(
      isValid(
        withProfile({
          projects: [
            {
              id: 'PRJ-1',
              name: 'P',
              related_experience_id: 'EXP-1',
              related_education_id: 'EDU-1',
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({ projects: [{ id: 'PRJ-1', name: 'P', related_experience_id: 'EDU-1' }] }),
      ),
    ).toBe(false);
    expect(
      isValid(
        withProfile({ projects: [{ id: 'PRJ-1', name: 'P', related_education_id: 'NADA' }] }),
      ),
    ).toBe(false);
    expect(
      isValid(
        withProfile({ competency_examples: [{ competency: 'C', related_skill_ids: ['SKL-1'] }] }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({ competency_examples: [{ competency: 'C', related_skill_ids: ['EXP-1'] }] }),
      ),
    ).toBe(false);
    expect(
      isValid(withProfile({ languages: [{ language: 'Ingles', certification_id: 'CERT-1' }] })),
    ).toBe(true);
    expect(
      isValid(withProfile({ languages: [{ language: 'Ingles', certification_id: 'SKL-1' }] })),
    ).toBe(false);
    expect(
      isValid(
        withProfile({
          resume_preferences: {
            older_experience_ids: ['EXP-1'],
            highlight_record_ids: ['EXP-1', 'PRJ-1'],
          },
        }),
      ),
    ).toBe(true);
    expect(isValid(withProfile({ resume_preferences: { older_experience_ids: ['PRJ-1'] } }))).toBe(
      false,
    );
    expect(isValid(withProfile({ resume_preferences: { highlight_record_ids: ['SKL-1'] } }))).toBe(
      false,
    );
  });

  it('pendencias e restricoes: alvo existe e o campo existe no tipo do alvo', () => {
    const target = (record_id: string, field?: string) => ({
      record_id,
      ...(field ? { field } : {}),
    });
    expect(
      isValid(
        withProfile({ pending_items: [{ subject: 'S', target: target('EXP-1', 'start_date') }] }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({
          pending_items: [{ subject: 'S', target: target('EXP-1', 'location.city') }],
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({
          pending_items: [{ subject: 'S', target: target('EXP-1', 'campo_inventado') }],
        }),
      ),
    ).toBe(false);
    expect(
      isValid(withProfile({ pending_items: [{ subject: 'S', target: target('EXP-1', 'name') }] })),
    ).toBe(false); // name e de projeto
    expect(
      isValid(withProfile({ pending_items: [{ subject: 'S', target: target('NADA') }] })),
    ).toBe(false);
    expect(
      isValid(
        withProfile({ pending_items: [{ subject: 'S', target: { field: 'identity.pronouns' } }] }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({
          pending_items: [{ subject: 'S', target: { field: 'profile.identity.pronouns' } }],
        }),
      ),
    ).toBe(true);
    expect(
      isValid(withProfile({ pending_items: [{ subject: 'S', target: { field: 'start_date' } }] })),
    ).toBe(false);
    expect(
      isValid(
        withProfile({
          usage_rules: {
            restrictions: [{ target: target('EXP-1', 'organization_name'), rule: 'never_include' }],
          },
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({
          usage_rules: {
            restrictions: [{ target: { term: 'sigiloso' }, rule: 'require_approval' }],
          },
        }),
      ),
    ).toBe(true);
    expect(
      isValid(
        withProfile({ usage_rules: { restrictions: [{ target: {}, rule: 'never_include' }] } }),
      ),
    ).toBe(false);
    expect(
      isValid(withProfile({ usage_rules: { restrictions: [{ target: { term: 'x' } }] } })),
    ).toBe(false);
    expect(
      isValid(
        withProfile({
          usage_rules: { restrictions: [{ target: target('EVD-1'), rule: 'never_include' }] },
        }),
      ),
    ).toBe(true);
  });

  it('duplicatas de competencia pela chave normalizada (ignora caixa e acentos)', () => {
    expect(
      isValid(doc({ skills: [{ name: 'Gestão de Estoques' }, { name: 'gestao de  estoques' }] })),
    ).toBe(false);
    expect(
      isValid(
        doc({ skills: [{ name: 'Java' }, { name: 'JavaScript' }, { name: 'C' }, { name: 'C#' }] }),
      ),
    ).toBe(true);
  });

  it('issues de integridade tem caminho preciso', () => {
    const issues = issuesOf(
      doc({
        experiences: [
          { id: 'A', organization_name: 'a' },
          { id: 'A', organization_name: 'b', meta: { evidence_ids: ['Z'] } },
        ],
      }),
    );
    expect(issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        'profile.experiences[1].id',
        'profile.experiences[1].meta.evidence_ids[0]',
      ]),
    );
  });
});

describe('contexto de uso de competencias (ADR-0007)', () => {
  const base = {
    skills: [{ id: 'S', name: 'Habilidade' }],
    experiences: [
      { id: 'EXP', organization_name: 'Org', employment_type: 'employee' },
      { id: 'EXV', organization_name: 'ONG', employment_type: 'volunteer' },
    ],
    projects: [{ id: 'PRJ', name: 'P' }],
    education: [{ id: 'EDU', institution: 'E' }],
    courses: [{ id: 'CRS', name: 'C' }],
    certifications: [{ id: 'CER', name: 'Cert' }],
    volunteering: [{ id: 'VOL', organization: 'ONG' }],
  };
  const usage = (extra: Record<string, unknown>) =>
    doc({ ...base, skill_usages: [{ skill_id: 'S', ...extra }] });

  it.each([
    ['professional_experience', { experience_id: 'EXP' }],
    ['project_experience', { project_id: 'PRJ' }],
    ['volunteer_experience', { volunteering_id: 'VOL' }],
    ['volunteer_experience', { experience_id: 'EXV' }],
    ['coursework', { education_id: 'EDU' }],
    ['coursework', { course_id: 'CRS' }],
    ['certification', { certification_id: 'CER' }],
    ['self_declared_knowledge', {}],
    ['self_declared_knowledge', { experience_id: 'EXP' }],
    ['conceptual_familiarity', {}],
    ['unverified', {}],
    ['unverified', { course_id: 'CRS' }],
  ])('%s com %j e valido', (usage_context, source) => {
    expect(isValid(usage({ usage_context, ...source }))).toBe(true);
  });

  it.each([
    ['professional_experience', {}],
    ['professional_experience', { project_id: 'PRJ' }],
    ['project_experience', { experience_id: 'EXP' }],
    ['project_experience', {}],
    ['volunteer_experience', {}],
    ['volunteer_experience', { experience_id: 'EXP' }], // experiencia nao e voluntaria
    ['coursework', {}],
    ['coursework', { certification_id: 'CER' }],
    ['certification', {}],
    ['certification', { course_id: 'CRS' }],
    ['unverified', { experience_id: 'EXP', project_id: 'PRJ' }], // mais de uma fonte
    ['professional_experience', { experience_id: 'NADA' }],
    ['professional_experience', { experience_id: 'PRJ' }], // id de outro tipo
  ])('%s com %j e invalido', (usage_context, source) => {
    expect(isValid(usage({ usage_context, ...source }))).toBe(false);
  });

  it('skill_id e usage_context sao obrigatorios e skill_id precisa existir', () => {
    expect(isValid(doc({ ...base, skill_usages: [{ usage_context: 'unverified' }] }))).toBe(false);
    expect(isValid(doc({ ...base, skill_usages: [{ skill_id: 'S' }] }))).toBe(false);
    expect(
      isValid(doc({ ...base, skill_usages: [{ skill_id: 'NADA', usage_context: 'unverified' }] })),
    ).toBe(false);
    expect(
      isValid(doc({ ...base, skill_usages: [{ skill_id: 'EXP', usage_context: 'unverified' }] })),
    ).toBe(false);
  });

  it('o mesmo skill pode ter varios contextos independentes', () => {
    expect(
      isValid(
        doc({
          ...base,
          skill_usages: [
            { skill_id: 'S', usage_context: 'professional_experience', experience_id: 'EXP' },
            { skill_id: 'S', usage_context: 'project_experience', project_id: 'PRJ' },
            { skill_id: 'S', usage_context: 'self_declared_knowledge' },
          ],
        }),
      ),
    ).toBe(true);
  });
});
