import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractMdAnnotatedPaths, listRecords } from '@chameleon/contracts';
import {
  detectTextFormat,
  importProfile,
  loadProfile,
  parseProfileMarkdown,
  parseProfileText,
} from '../src/index';
import { sequentialIds } from './fixtures';

const TEMPLATE_PATH = resolve(
  __dirname,
  '../../../templates/profile/MODELO_UNIVERSAL_PERFIL_PROFISSIONAL.v2.md',
);
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8');

type Json = Record<string, unknown>;

/** Small hand-written Markdown with the template's line grammar. */
const form = (...lines: string[]): string =>
  ['**Versão do modelo:** 2.1.0 <!-- path: schema_version -->', '', ...lines, ''].join('\n');

const field = (label: string, answer: string, path: string): string =>
  `- **${label}:** ${answer} <!-- path: ${path} -->`;

function parseOk(text: string): { data: Json; warnings: Json[]; unmapped: Json[] } {
  const result = parseProfileMarkdown(text);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return {
    data: result.data,
    warnings: result.warnings,
    unmapped: result.unmapped,
  };
}

const profileOf = (text: string): Json => parseOk(text).data.profile as Json;

/** Fills the `[Preencher]` placeholder of the nth line that carries `path`. */
function fill(source: string, path: string, answer: string, nth = 1): string {
  const marker = `<!-- path: ${path} -->`;
  const lines = source.split('\n');
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.includes(marker)) continue;
    seen += 1;
    if (seen !== nth) continue;
    expect(line, `placeholder expected on line for ${path}`).toContain('`[Preencher]`');
    lines[index] = line.replace('`[Preencher]`', () => answer);
    return lines.join('\n');
  }
  throw new Error(`annotation not found: ${path} #${nth}`);
}

/** Replaces the options text that precedes the annotation of the nth `path` line. */
function choose(source: string, path: string, options: string, answer: string, nth = 1): string {
  const marker = `<!-- path: ${path} -->`;
  const lines = source.split('\n');
  let seen = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.includes(marker)) continue;
    seen += 1;
    if (seen !== nth) continue;
    expect(line, `options text expected for ${path}`).toContain(options);
    lines[index] = line.replace(options, () => answer);
    return lines.join('\n');
  }
  throw new Error(`annotation not found: ${path} #${nth}`);
}

/** The block of the template between a heading line and the next `---` rule. */
function block(source: string, heading: string): string {
  const start = source.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n---\n', start);
  return source.slice(start, end);
}

// ---------------------------------------------------------------------------------------------

describe('format detection', () => {
  it('recognises the annotated template as markdown, JSON by "{", YAML otherwise', () => {
    expect(detectTextFormat(TEMPLATE)).toBe('markdown');
    expect(detectTextFormat('\uFEFF' + TEMPLATE)).toBe('markdown');
    expect(detectTextFormat('{"schema_version":"2.1.0"}')).toBe('json');
    expect(detectTextFormat('schema_version: "2.1.0"\nprofile: {}\n')).toBe('yaml');
    expect(detectTextFormat('# titulo sem anotacoes\n\ntexto livre')).toBe('yaml');
  });

  it('lets an extension or MIME hint decide, and never mistakes YAML that mentions a comment', () => {
    expect(detectTextFormat('texto', { filename: 'perfil.md' })).toBe('markdown');
    expect(detectTextFormat('texto', { filename: 'PERFIL.MARKDOWN' })).toBe('markdown');
    expect(detectTextFormat('texto', { contentType: 'text/markdown; charset=utf-8' })).toBe(
      'markdown',
    );
    expect(detectTextFormat('a: 1', { filename: 'x.json' })).toBe('json');
    expect(detectTextFormat('a: 1', { filename: 'x.yml' })).toBe('yaml');
    const yamlWithComment =
      'schema_version: "2.1.0"\nprofile:\n  identity:\n    full_name: "a <!-- path: x --> b"\n';
    expect(detectTextFormat(yamlWithComment)).toBe('yaml');
  });

  it('parseProfileText dispatches to the Markdown parser and returns notices', () => {
    const result = parseProfileText(form(field('Nome', 'Ana', 'profile.identity.full_name')));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('markdown');
      expect(result.warnings).toBeDefined();
      expect(result.unmapped).toEqual([]);
    }
  });
});

describe('the unfilled template', () => {
  it('parses to zero records and no stray values', () => {
    const result = parseProfileMarkdown(TEMPLATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ schema_version: '2.1.0', profile: {} });
    expect(result.unmapped).toEqual([]);
    expect(result.warnings.filter((w) => w.severity === 'warning')).toEqual([]);
    // every annotation of the template is recognised (the contract test guarantees they are valid)
    expect(result.stats.annotations).toBe(extractMdAnnotatedPaths(TEMPLATE).length);
    expect(result.stats.recognized).toBe(result.stats.annotations);
  });

  it('reports the "all options listed" answers once, as information', () => {
    const result = parseProfileMarkdown(TEMPLATE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const listed = result.warnings.filter((w) => w.code === 'EMPTY_STRING_NORMALIZED');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.path).toBeNull();
    expect(listed[0]?.severity).toBe('info');
  });

  it('imports as an empty profile through the pipeline (CRLF and BOM included)', () => {
    for (const variant of [TEMPLATE, TEMPLATE.replace(/\n/g, '\r\n'), `\uFEFF${TEMPLATE}`]) {
      const loaded = loadProfile(variant);
      expect(loaded.ok).toBe(true);
      expect(loaded.report.errors).toEqual([]);
      expect(listRecords(loaded.document)).toEqual([]);
      expect(loaded.document?.profile).toEqual({});
    }
  });
});

describe('a hand-filled copy of the real template', () => {
  let filled = TEMPLATE;
  filled = fill(filled, 'locale', 'pt-BR');
  filled = fill(filled, 'profile.identity.full_name', 'Marina Exemplo Quaresma');
  filled = fill(filled, 'profile.identity.city', 'Cidade Ficticia');
  filled = fill(filled, 'profile.identity.countries_of_work_interest', 'BR; PT');
  filled = choose(filled, 'profile.identity.field_visibility.city', '`[Preencher]`', 'private');
  // contact: the "Valor (long hint): answer" label style
  filled = fill(filled, 'profile.contact_points[].id', 'CP-001');
  filled = choose(filled, 'profile.contact_points[].kind', '`email`, `phone` ou `link`', '`phone`');
  filled = fill(filled, 'profile.contact_points[].value', '(99) 90000-0101');
  filled = choose(
    filled,
    'profile.contact_points[].include_by_default',
    '`true` ou `false`',
    'sim',
  );
  // positioning
  filled = fill(filled, 'profile.positioning.current_profession', 'Enfermeira');
  filled = choose(
    filled,
    'profile.positioning.current_seniority',
    '`student`, `entry`, `junior`, `mid`, `senior`, `specialist`, `lead`, `manager`, `executive` ou `not_assessed`',
    'mid',
  );
  // an experience with an item of each kind (4.3 / 4.4 / 4.5) and governance
  filled = fill(filled, 'profile.experiences[].id', 'EXP-001');
  filled = fill(filled, 'profile.experiences[].organization_name', 'Hospital Ficticio');
  filled = fill(filled, 'profile.experiences[].official_title', 'Enfermeira assistencial');
  filled = choose(
    filled,
    'profile.experiences[].employment_type',
    '`employee`, `internship`, `apprenticeship`, `contractor`, `freelance`, `self_employed`, `business_owner`, `temporary`, `public_service`, `volunteer` ou `other`',
    'employee',
  );
  filled = fill(filled, 'profile.experiences[].start_date', '2019-03');
  filled = fill(filled, 'profile.experiences[].end_date', 'present');
  filled = fill(filled, 'profile.experiences[].items[].text', 'Cuidados intensivos', 1);
  filled = fill(filled, 'profile.experiences[].items[].text', 'Protocolo de higiene adotado', 2);
  filled = fill(filled, 'profile.experiences[].items[].text', 'Reducao de incidentes', 3);
  filled = fill(filled, 'profile.experiences[].items[].metric.value', '35%');
  filled = choose(
    filled,
    'profile.experiences[].items[].meta.resume_use',
    '`allowed` (sim), `requires_approval` (parcialmente/com aprovação) ou `never` (não)',
    'parcialmente',
    3,
  );
  filled = fill(filled, 'profile.experiences[].lessons_learned', 'Comunicar cedo; Registrar tudo');
  filled = choose(
    filled,
    'profile.experiences[].meta.visibility',
    '`public`, `private` ou `conditional`',
    'private',
  );
  // a language with a descriptive level
  filled = fill(filled, 'profile.languages[].language', 'Inglês');
  filled = fill(filled, 'profile.languages[].self_described_level', 'avançado');
  // a project with a collaborator and an item, and label styles "**Pergunta? (lista)** resposta"
  filled = fill(filled, 'profile.projects[].name', 'Projeto Ficticio');
  filled = choose(
    filled,
    'profile.projects[].public_access',
    '`public` (sim), `partial` (parcialmente) ou `not_public` (não)',
    'parcialmente',
  );
  filled = fill(filled, 'profile.projects[].collaborators[].name_or_role', 'Dev backend');
  filled = choose(
    filled,
    'profile.projects[].items[].kind',
    '`feature`, `contribution`, `deliverable`, `outcome`, `metric`, `business_rule`, `workflow`, `decision`, `test` ou `integration`',
    'feature',
  );
  filled = fill(filled, 'profile.projects[].items[].text', 'Cadastro de pacientes');
  filled = fill(
    filled,
    'profile.career_preferences.preferred_responsibilities',
    'Mentoria; Planejamento',
  );
  filled = choose(
    filled,
    'profile.career_preferences.interest_in_adjacent_fields',
    '`yes`, `no` ou `depends`',
    'depends',
  );

  const result = parseProfileMarkdown(filled);

  it('reads every filled field into the interchange shape and leaves the rest absent', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = result.data.profile as Json;
    expect(result.data.locale).toBe('pt-BR');
    expect(profile.identity).toEqual({
      full_name: 'Marina Exemplo Quaresma',
      city: 'Cidade Ficticia',
      countries_of_work_interest: ['BR', 'PT'],
      field_visibility: { city: 'private' },
    });
    expect(profile.contact_points).toEqual([
      { id: 'CP-001', kind: 'phone', value: '(99) 90000-0101', include_by_default: true },
    ]);
    expect(profile.positioning).toEqual({
      current_profession: 'Enfermeira',
      current_seniority: 'mid',
    });
    expect(profile.languages).toEqual([{ language: 'Inglês', self_described_level: 'avançado' }]);
  });

  it('reads projects, nested collaborators and items, and every label style of the template', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = result.data.profile as Json;
    expect(profile.projects).toEqual([
      {
        name: 'Projeto Ficticio',
        public_access: 'partial',
        collaborators: [{ name_or_role: 'Dev backend' }],
        items: [{ kind: 'feature', text: 'Cadastro de pacientes' }],
      },
    ]);
    expect(profile.career_preferences).toEqual({
      preferred_responsibilities: ['Mentoria', 'Planejamento'],
      interest_in_adjacent_fields: 'depends',
    });
  });

  it('keeps the three item blocks of an experience apart and keeps their template kinds', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const experiences = (result.data.profile as Json).experiences as Json[];
    expect(experiences).toHaveLength(1);
    const experience = experiences[0]!;
    expect(experience).toMatchObject({
      id: 'EXP-001',
      organization_name: 'Hospital Ficticio',
      employment_type: 'employee',
      start_date: '2019-03',
      end_date: 'present',
      lessons_learned: ['Comunicar cedo', 'Registrar tudo'],
      meta: { visibility: 'private' },
    });
    expect(experience.items).toEqual([
      { kind: 'responsibility', text: 'Cuidados intensivos' },
      { kind: 'delivery', text: 'Protocolo de higiene adotado' },
      {
        kind: 'achievement',
        text: 'Reducao de incidentes',
        metric: { value: '35%' },
        meta: { resume_use: 'requires_approval' },
      },
    ]);
  });

  it('is imported by the pipeline: needs_review, privacy kept, no sentinel text anywhere', () => {
    const imported = importProfile(filled, {
      hint: { filename: 'perfil.md' },
      generateId: sequentialIds(),
    });
    expect(imported.report.errors).toEqual([]);
    expect(imported.ok).toBe(true);
    const document = imported.document;
    expect(document?.profile.experiences?.[0]?.meta?.status).toBe('needs_review');
    expect(document?.profile.experiences?.[0]?.meta?.visibility).toBe('private');
    expect(document?.profile.contact_points?.[0]?.value).toBe('99900000101');
    expect(JSON.stringify(document)).not.toMatch(/Preencher|Não informado/i);
    expect(imported.report.steps.map((step) => step.id)).toContain('parse_markdown');
  });

  it('supports several records of the same repeated section', () => {
    const experienceBlock = block(TEMPLATE, '## Experiência — registro 1');
    const second = experienceBlock.replace('registro 1', 'registro 2');
    let text = TEMPLATE.replace(experienceBlock, `${experienceBlock}\n\n${second}`);
    text = fill(text, 'profile.experiences[].organization_name', 'Primeira Empresa Ficticia', 1);
    text = fill(text, 'profile.experiences[].official_title', 'Analista', 1);
    text = fill(text, 'profile.experiences[].organization_name', 'Segunda Empresa Ficticia', 2);
    text = fill(text, 'profile.experiences[].items[].text', 'Item da segunda', 4);
    text = fill(text, 'profile.experiences[].organization_group', 'Grupo', 2);
    const parsed = parseProfileMarkdown(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const experiences = (parsed.data.profile as Json).experiences as Json[];
    expect(experiences).toHaveLength(2);
    expect(experiences[0]).toMatchObject({
      organization_name: 'Primeira Empresa Ficticia',
      official_title: 'Analista',
    });
    expect(experiences[0]?.organization_group).toBeUndefined();
    expect(experiences[1]).toMatchObject({
      organization_name: 'Segunda Empresa Ficticia',
      organization_group: 'Grupo',
      items: [{ kind: 'responsibility', text: 'Item da segunda' }],
    });
  });

  it('attaches the 8.3 study plan to the last skill and says so', () => {
    let text = fill(TEMPLATE, 'profile.skills[].name', 'Ventilação mecânica');
    text = fill(text, 'profile.skills[].study_plan.next_goal', 'Certificação avançada');
    const parsed = parseProfileMarkdown(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect((parsed.data.profile as Json).skills).toEqual([
      { name: 'Ventilação mecânica', study_plan: { next_goal: 'Certificação avançada' } },
    ]);
    expect(parsed.warnings.find((w) => w.code === 'RECORD_RELOCATED')?.path).toBe(
      'profile.skills[0]',
    );
  });
});

describe('absence: placeholders, blanks and "not provided" texts', () => {
  const cases: [string, string][] = [
    ['placeholder', '`[Preencher]`'],
    ['bare placeholder', '[Preencher]'],
    ['english placeholder', '[Fill in]'],
    ['blank', ''],
    ['underscore', '_'],
    ['dash', '-'],
    ['long dash', '—'],
    ['ellipsis', '...'],
    ['empty backticks', '``'],
  ];
  it.each(cases)('treats %s as absent (no key, no warning)', (_name, answer) => {
    const result = parseOk(form(field('Nome', answer, 'profile.identity.full_name')));
    expect(result.data.profile).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  const sentinels = [
    'Não informado',
    'nao informado',
    '**Não informado**',
    '`Não informado`',
    'NÃO INFORMADO.',
    'N/A',
    'Not provided',
    'Sem informação',
    'Desconhecido',
  ];
  it.each(sentinels)('never lets the sentinel %s leak as a value', (answer) => {
    const result = parseOk(
      form(
        field('Nome', answer, 'profile.identity.full_name'),
        field('Cargo', answer, 'profile.experiences[].official_title'),
        field('Tags', answer, 'profile.skills[].aliases'),
      ),
    );
    expect(JSON.stringify(result.data)).not.toMatch(
      /informado|n\/a|provided|informa|desconhecido/i,
    );
    expect(result.data.profile).toEqual({});
    expect(result.warnings.every((w) => w.severity === 'info')).toBe(true);
  });

  it('keeps ordinary text that merely contains the words', () => {
    const result = parseOk(
      form(
        field(
          'Contexto',
          'Cliente não informado ao candidato',
          'profile.experiences[].company_context',
        ),
      ),
    );
    expect((result.data.profile as Json).experiences).toEqual([
      { company_context: 'Cliente não informado ao candidato' },
    ]);
  });

  it('an empty record is not created and never appears as a negative fact', () => {
    const result = parseOk(
      form(
        field('Id', 'EXP-001', 'profile.experiences[].id'),
        field('Tipo do item', '`responsibility`', 'profile.experiences[].items[].kind'),
        field('Modalidade', '`onsite`, `hybrid` ou `remote`', 'profile.experiences[].work_mode'),
      ),
    );
    expect(result.data.profile).toEqual({});
  });
});

describe('explicit state markers', () => {
  const marker = (answer: string, path = 'profile.identity.pronouns'): Json =>
    parseOk(form(field('Campo', answer, path))).data.profile as Json;

  it.each([
    ['(não se aplica)', 'not_applicable'],
    ['(nao se aplica)', 'not_applicable'],
    ['`(prefiro não informar)`', 'declined'],
    ['(ainda não avaliei)', 'not_assessed'],
    ['(confirmar depois)', 'needs_confirmation'],
    ['não se aplica', 'not_applicable'],
    ['(Not applicable)', 'not_applicable'],
  ])('maps %s to field_states.%s on a block, with no value', (answer, state) => {
    expect(marker(answer)).toEqual({ identity: { field_states: { pronouns: state } } });
  });

  it('records the state in meta.field_states on a fact record, including nested fields', () => {
    const result = parseOk(
      form(
        field('Cargo', 'Analista', 'profile.experiences[].official_title'),
        field('Motivo', '(prefiro não informar)', 'profile.experiences[].exit_reason'),
        field('Valor', '(confirmar depois)', 'profile.experiences[].items[].metric.value'),
        field('Texto', 'Entrega', 'profile.experiences[].items[].text'),
      ),
    );
    expect((result.data.profile as Json).experiences).toEqual([
      {
        official_title: 'Analista',
        meta: { field_states: { exit_reason: 'declined' } },
        items: [
          { text: 'Entrega', meta: { field_states: { 'metric.value': 'needs_confirmation' } } },
        ],
      },
    ]);
  });

  it('keeps the value next to a trailing "(confirmar depois)" and the state', () => {
    const result = parseOk(
      form(
        field('Cargo', 'Analista', 'profile.experiences[].official_title'),
        field('Início', '2020-05 (confirmar depois)', 'profile.experiences[].start_date'),
        field('Aprendizados', 'a; b (confirmar depois)', 'profile.experiences[].lessons_learned'),
      ),
    );
    expect((result.data.profile as Json).experiences).toEqual([
      {
        official_title: 'Analista',
        start_date: '2020-05',
        lessons_learned: ['a', 'b'],
        meta: {
          field_states: { start_date: 'needs_confirmation', lessons_learned: 'needs_confirmation' },
        },
      },
    ]);
  });

  it('drops a value typed next to an exclusive marker (declined means declined) and warns', () => {
    const result = parseOk(
      form(field('Pronomes', '(prefiro não informar) ela/dela', 'profile.identity.pronouns')),
    );
    expect(result.data.profile).toEqual({ identity: { field_states: { pronouns: 'declined' } } });
    expect(result.warnings.map((w) => w.code)).toEqual(['INVALID_VALUE_DROPPED']);
    expect(JSON.stringify(result.warnings)).not.toContain('ela/dela');
  });

  it('refuses a state on a record type without field_states and says so', () => {
    const result = parseOk(
      form(
        field('Valor', 'ana@example.test', 'profile.contact_points[].value'),
        field('Rótulo', '(não se aplica)', 'profile.contact_points[].label'),
      ),
    );
    expect((result.data.profile as Json).contact_points).toEqual([{ value: 'ana@example.test' }]);
    expect(result.warnings.map((w) => w.code)).toEqual(['INVALID_VALUE_DROPPED']);
  });

  it('is accepted by the contract end to end', () => {
    const loaded = loadProfile(
      form(
        field('Cargo', 'Analista', 'profile.experiences[].official_title'),
        field('Motivo', '(prefiro não informar)', 'profile.experiences[].exit_reason'),
        field('Pronomes', '(não se aplica)', 'profile.identity.pronouns'),
      ),
    );
    expect(loaded.report.errors).toEqual([]);
    expect(loaded.document?.profile.experiences?.[0]?.meta?.field_states).toEqual({
      exit_reason: 'declined',
    });
    expect(loaded.document?.profile.identity?.field_states).toEqual({ pronouns: 'not_applicable' });
  });
});

describe('multi-choice answers map to the contract enums without loss', () => {
  const one = (path: string, answer: string): unknown => {
    const profile = profileOf(form(field('Campo', answer, path)));
    return profile;
  };
  const publicAccess = 'profile.projects[].public_access';
  const sharing = 'profile.evidence[].recruiter_sharing';
  const resumeUse = 'profile.statements[].meta.resume_use';

  it.each([
    ['`public` (sim)', 'public'],
    ['public', 'public'],
    ['sim', 'public'],
    ['Sim.', 'public'],
    ['`partial` (parcialmente)', 'partial'],
    ['parcialmente', 'partial'],
    ['`not_public` (não)', 'not_public'],
    ['não', 'not_public'],
    ['NAO', 'not_public'],
  ])('public / partial / not_public: %s -> %s', (answer, expected) => {
    expect(one(publicAccess, answer)).toEqual({ projects: [{ public_access: expected }] });
  });

  it.each([
    ['allowed', 'allowed'],
    ['sim', 'allowed'],
    ['`restricted` (com restrição)', 'restricted'],
    ['com restrição', 'restricted'],
    ['não', 'not_allowed'],
    ['`not_allowed` (não)', 'not_allowed'],
  ])('allowed / restricted / not_allowed: %s -> %s', (answer, expected) => {
    expect(one(sharing, answer)).toEqual({ evidence: [{ recruiter_sharing: expected }] });
  });

  it.each([
    ['allowed', 'allowed'],
    ['sim', 'allowed'],
    ['parcialmente', 'requires_approval'],
    ['com aprovação', 'requires_approval'],
    ['`requires_approval` (parcialmente/com aprovação)', 'requires_approval'],
    ['não', 'never'],
    ['never', 'never'],
  ])('resume_use: %s -> %s', (answer, expected) => {
    const profile = profileOf(
      form(field('Texto', 'Resumo', 'profile.statements[].text'), field('Uso', answer, resumeUse)),
    );
    expect(profile).toEqual({ statements: [{ text: 'Resumo', meta: { resume_use: expected } }] });
  });

  it.each([
    ['yes', 'yes'],
    ['sim', 'yes'],
    ['não', 'no'],
    ['depende', 'depends'],
    ['depends', 'depends'],
  ])('tri-state: %s -> %s', (answer, expected) => {
    expect(one('profile.availability_preferences.willing_to_relocate', answer)).toEqual({
      availability_preferences: { willing_to_relocate: expected },
    });
  });

  it('treats the printed options list as "nothing chosen" (no key) and counts it', () => {
    const options =
      '`allowed` (sim), `requires_approval` (parcialmente/com aprovação) ou `never` (não)';
    const result = parseOk(form(field('Uso', options, resumeUse)));
    expect(result.data.profile).toEqual({});
    expect(result.warnings.map((w) => w.code)).toEqual(['EMPTY_STRING_NORMALIZED']);
  });

  it('rejects a value outside the options with a path-only warning and keeps it in unmapped', () => {
    const result = parseOk(form(field('Uso', 'talvez-CANARY-9', resumeUse)));
    expect(result.data.profile).toEqual({});
    expect(result.warnings.map((w) => w.code)).toEqual(['INVALID_ENUM_VALUE_DROPPED']);
    expect(JSON.stringify(result.warnings)).not.toContain('CANARY');
    expect(result.unmapped).toHaveLength(1);
    expect(result.unmapped[0]?.value).toBe('talvez-CANARY-9');
  });

  it('maps every CEFR level, case-insensitively', () => {
    const profile = profileOf(
      form(
        field('Idioma', 'Inglês', 'profile.languages[].language'),
        field('Nível', 'b2', 'profile.languages[].overall_level'),
        field('Leitura', '`C1`', 'profile.languages[].reading'),
        field('Fala', 'native', 'profile.languages[].speaking'),
      ),
    );
    expect(profile.languages).toEqual([
      { language: 'Inglês', overall_level: 'B2', reading: 'C1', speaking: 'native' },
    ]);
  });

  it('keeps "(ainda não avaliei)" as a state while `not_assessed` stays a level', () => {
    const profile = profileOf(
      form(
        field('Nome', 'SQL', 'profile.skills[].name'),
        field('Nível', '`not_assessed`', 'profile.skills[].self_assessed_level'),
        field('Última', '(ainda não avaliei)', 'profile.skills[].last_used'),
      ),
    );
    expect(profile.skills).toEqual([
      {
        name: 'SQL',
        self_assessed_level: 'not_assessed',
        meta: { field_states: { last_used: 'not_assessed' } },
      },
    ]);
  });

  it('booleans: true/false/sim/não; both listed means unanswered; nonsense is dropped', () => {
    const path = 'profile.contact_points[].is_primary';
    expect(one(path, 'true')).toEqual({ contact_points: [{ is_primary: true }] });
    expect(one(path, 'Não')).toEqual({ contact_points: [{ is_primary: false }] });
    expect(one(path, 'sim')).toEqual({ contact_points: [{ is_primary: true }] });
    const listed = parseOk(form(field('P', '`true` ou `false`', path)));
    expect(listed.data.profile).toEqual({});
    expect(listed.warnings.map((w) => w.code)).toEqual(['EMPTY_STRING_NORMALIZED']);
    const bad = parseOk(form(field('P', 'talvez', path)));
    expect(bad.data.profile).toEqual({});
    expect(bad.warnings.map((w) => w.code)).toEqual(['INVALID_VALUE_DROPPED']);
  });

  it('enum lists: subset kept, every option printed in backticks means unanswered', () => {
    const path = 'profile.availability_preferences.preferred_work_modes';
    expect(one(path, 'remote, hybrid')).toEqual({
      availability_preferences: { preferred_work_modes: ['remote', 'hybrid'] },
    });
    expect(one(path, '`remote`')).toEqual({
      availability_preferences: { preferred_work_modes: ['remote'] },
    });
    const printed = parseOk(form(field('M', '`onsite`, `hybrid`, `remote`', path)));
    expect(printed.data.profile).toEqual({});
    // a deliberate choice of every option (no backticks) is respected
    expect(one(path, 'onsite, hybrid, remote')).toEqual({
      availability_preferences: { preferred_work_modes: ['onsite', 'hybrid', 'remote'] },
    });
    const unknown = parseOk(form(field('M', 'remote, teletransporte', path)));
    expect((unknown.data.profile as Json).availability_preferences).toEqual({
      preferred_work_modes: ['remote'],
    });
    expect(unknown.warnings.map((w) => w.code)).toContain('INVALID_ENUM_VALUE_DROPPED');
  });
});

describe('numbers, dates and text', () => {
  it('reads plain and localised numbers and rejects ambiguous ones', () => {
    const num = (answer: string): unknown =>
      (
        profileOf(form(field('H', answer, 'profile.courses[].workload_hours'))).courses as
          Json[] | undefined
      )?.[0]?.workload_hours;
    expect(num('40')).toBe(40);
    expect(num('40,5')).toBe(40.5);
    expect(num('40.5')).toBe(40.5);
    expect(num('1.500,50')).toBe(1500.5);
    expect(num('1,500.50')).toBe(1500.5);
    expect(num('1.500')).toBeUndefined();
    expect(num('quarenta')).toBeUndefined();
    expect(num('12abc')).toBeUndefined();
    expect(num('1e9')).toBeUndefined();
    const dropped = parseOk(form(field('H', '1.500', 'profile.courses[].workload_hours')));
    expect(dropped.warnings.map((w) => w.code)).toEqual(['INVALID_VALUE_DROPPED']);
  });

  it('keeps dates at the precision typed and understands "present"', () => {
    const profile = profileOf(
      form(
        field('Id', 'EXP-1', 'profile.experiences[].id'),
        field('Início', '2018', 'profile.experiences[].start_date'),
        field('Fim', 'Atual', 'profile.experiences[].end_date'),
        field('Id', 'EXP-2', 'profile.experiences[].id'),
        field('Início', '2020-05', 'profile.experiences[].start_date'),
        field('Fim', '2021-02-14', 'profile.experiences[].end_date'),
        field('Id', 'EXP-3', 'profile.experiences[].id'),
        field('Início', '2022-01', 'profile.experiences[].start_date'),
        field('Fim', 'present', 'profile.experiences[].end_date'),
      ),
    );
    expect((profile.experiences as Json[]).map((e) => [e.start_date, e.end_date])).toEqual([
      ['2018', 'present'],
      ['2020-05', '2021-02-14'],
      ['2022-01', 'present'],
    ]);
  });

  it('strips one pair of wrapping backticks from text, keeps inline code and markup, and joins continuation lines', () => {
    const profile = profileOf(
      [
        '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->',
        field('Nome', '`Ana Exemplo`', 'profile.identity.full_name'),
        field('Cidade', 'Usa `C#` e **negrito**', 'profile.identity.city'),
        '- **Texto:** primeira linha <!-- path: profile.statements[].text -->',
        '  segunda linha',
        '',
        '  terceira linha depois de um paragrafo',
        '',
        'Texto solto sem recuo e sem anotacao.',
      ].join('\n'),
    );
    expect((profile.identity as Json).full_name).toBe('Ana Exemplo');
    expect((profile.identity as Json).city).toBe('Usa `C#` e **negrito**');
    expect((profile.statements as Json[])[0]?.text).toBe(
      'primeira linha\nsegunda linha\n\nterceira linha depois de um paragrafo',
    );
  });

  it('handles non-ASCII text: accents, CJK, emoji, right-to-left and decomposed forms', () => {
    const decomposed = 'José Zoë';
    const text = form(
      field('Nome', decomposed, 'profile.identity.full_name'),
      field('Cidade', '東京 😀', 'profile.identity.city'),
      field('Região', 'القاهرة', 'profile.identity.region'),
    );
    const loaded = loadProfile(text);
    expect(loaded.ok).toBe(true);
    expect(loaded.document?.profile.identity).toEqual({
      full_name: 'José Zoë',
      city: '東京 😀',
      region: 'القاهرة',
    });
  });
});

describe('lists', () => {
  const list = (answerLines: string[]): unknown => {
    const text = form(
      `- **Aprendizados:** ${answerLines[0] ?? ''} <!-- path: profile.experiences[].lessons_learned -->`,
      ...answerLines.slice(1),
    );
    return (profileOf(text).experiences as Json[] | undefined)?.[0]?.lessons_learned;
  };

  it('splits inline answers on commas, or on semicolons when any is present', () => {
    expect(list(['a, b, c'])).toEqual(['a', 'b', 'c']);
    expect(list(['a, com vírgula; b'])).toEqual(['a, com vírgula', 'b']);
    expect(list(['um único item, com vírgula;'])).toEqual(['um único item, com vírgula']);
  });

  it('reads nested bullets as atomic items, with wrapped lines and mixed markers', () => {
    expect(
      list(['', '  - primeiro, com vírgula', '  * segundo', '    continua aqui', '  3. terceiro']),
    ).toEqual(['primeiro, com vírgula', 'segundo continua aqui', 'terceiro']);
  });

  it('drops placeholders and empty items inside lists, and yields no key when nothing is left', () => {
    expect(list(['a, , `[Preencher]`, b'])).toEqual(['a', 'b']);
    expect(list(['`[Preencher]`'])).toBeUndefined();
    expect(list(['  ,  ; '])).toBeUndefined();
  });
});

describe('record boundaries', () => {
  it('starts a new record at "registro N" headings, at a repeated field and at an id', () => {
    const text = [
      '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->',
      '## Contato — registro 1',
      field('Valor', 'a@example.test', 'profile.contact_points[].value'),
      field('Tipo', 'email', 'profile.contact_points[].kind'),
      '## Contato — registro 2',
      field('Tipo', 'link', 'profile.contact_points[].kind'),
      field('Valor', 'https://example.test/b', 'profile.contact_points[].value'),
      field('Valor', 'https://example.test/c', 'profile.contact_points[].value'),
      field('Id', 'CP-9', 'profile.contact_points[].id'),
      field('Valor', 'https://example.test/d', 'profile.contact_points[].value'),
    ].join('\n');
    const contacts = (profileOf(text).contact_points as Json[]).map((c) => c.value);
    expect(contacts).toEqual([
      'a@example.test',
      'https://example.test/b',
      'https://example.test/c',
      'https://example.test/d',
    ]);
  });

  it('separates child records by heading, repeated field or id, and nests them in the right parent', () => {
    const text = [
      '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->',
      '## Experiência — registro 1',
      field('Cargo', 'Cargo A', 'profile.experiences[].official_title'),
      '### 4.3',
      field('Texto', 'A1', 'profile.experiences[].items[].text'),
      field('Texto', 'A2', 'profile.experiences[].items[].text'),
      '### 4.4',
      field('Texto', 'A3', 'profile.experiences[].items[].text'),
      '## Experiência — registro 2',
      field('Cargo', 'Cargo B', 'profile.experiences[].official_title'),
      '### 4.3',
      field('Texto', 'B1', 'profile.experiences[].items[].text'),
      '## Projeto — registro 1',
      field('Nome', 'Projeto', 'profile.projects[].name'),
      field('Nome ou papel', 'Dev', 'profile.projects[].collaborators[].name_or_role'),
      field('Nome ou papel', 'QA', 'profile.projects[].collaborators[].name_or_role'),
    ].join('\n');
    const profile = profileOf(text);
    const experiences = profile.experiences as Json[];
    expect(
      experiences.map((e) => [e.official_title, (e.items as Json[]).map((i) => i.text)]),
    ).toEqual([
      ['Cargo A', ['A1', 'A2', 'A3']],
      ['Cargo B', ['B1']],
    ]);
    expect((profile.projects as Json[])[0]?.collaborators).toEqual([
      { name_or_role: 'Dev' },
      { name_or_role: 'QA' },
    ]);
  });

  it('supports partial records (only some fields) and a collection nested under a block', () => {
    const profile = profileOf(
      form(
        field('Regra', 'never_include', 'profile.usage_rules.restrictions[].rule'),
        field('Termo', 'Cliente Ficticio', 'profile.usage_rules.restrictions[].target.term'),
        field('Regra', 'require_approval', 'profile.usage_rules.restrictions[].rule'),
        field('Campo', 'identity.pronouns', 'profile.usage_rules.restrictions[].target.field'),
      ),
    );
    expect(profile.usage_rules).toEqual({
      restrictions: [
        { rule: 'never_include', target: { term: 'Cliente Ficticio' } },
        { rule: 'require_approval', target: { field: 'identity.pronouns' } },
      ],
    });
  });

  it('indented annotated lines are still their own fields', () => {
    const profile = profileOf(
      [
        '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->',
        '- **Bloco**',
        `    ${field('Nome', 'Ana', 'profile.identity.full_name')}`,
        `    ${field('Cidade', 'Rio', 'profile.identity.city')}`,
      ].join('\n'),
    );
    expect(profile.identity).toEqual({ full_name: 'Ana', city: 'Rio' });
  });
});

describe('wrong, unknown and duplicate annotations', () => {
  it('reports a path that is not in the contract and does not apply it', () => {
    const result = parseOk(
      form(
        field('Nome', 'Ana', 'profile.identity.full_name'),
        field('X', 'valor-CANARY-1', 'profile.identity.nao_existe'),
        field('Y', 'valor-CANARY-2', 'profile.experiences[].nao_existe'),
        field('Z', 'valor-CANARY-3', 'identity.full_name'),
      ),
    );
    expect(result.data.profile).toEqual({ identity: { full_name: 'Ana' } });
    expect(result.warnings.filter((w) => w.code === 'UNKNOWN_KEY_UNMAPPED')).toHaveLength(3);
    expect(JSON.stringify(result.warnings)).not.toContain('CANARY');
    expect(JSON.stringify(result.warnings)).not.toContain('nao_existe');
    expect(result.unmapped).toHaveLength(3);
  });

  it('refuses importer-owned technical paths (status, source, field_states...)', () => {
    const result = parseOk(
      form(
        field('Texto', 'Resumo', 'profile.statements[].text'),
        field('Tipo', 'short_summary', 'profile.statements[].kind'),
        field('Status', 'confirmed', 'profile.statements[].meta.status'),
        field('Fonte', 'document', 'profile.statements[].meta.source'),
        field('Estados', 'x', 'profile.statements[].meta.field_states'),
        field('Estados', 'x', 'profile.identity.field_states'),
      ),
    );
    expect((result.data.profile as Json).statements).toEqual([
      { kind: 'short_summary', text: 'Resumo' },
    ]);
    expect(result.unmapped).toHaveLength(4);
  });

  it('never pollutes prototypes and never copies forbidden keys, whatever the annotation says', () => {
    const result = parseOk(
      form(
        field('Nome', 'Ana', 'profile.identity.full_name'),
        field('A', 'x', 'profile.__proto__.polluted'),
        field('B', 'x', '__proto__.polluted'),
        field('C', 'x', 'profile.constructor.prototype.polluted'),
        field('D', 'x', 'profile.experiences[].__proto__.polluted'),
        field('E', 'x', 'profile.prototype'),
      ),
    );
    expect(({} as Json).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.data, '__proto__')).toBe(false);
    expect(JSON.stringify(result.data)).not.toMatch(/polluted|__proto__|constructor/);
    expect(result.warnings).toHaveLength(5);
  });

  it('keeps the first value of a repeated singleton and warns without echoing', () => {
    const result = parseOk(
      form(
        field('Nome', 'Primeiro-CANARY', 'profile.identity.full_name'),
        field('Nome', 'Segundo-CANARY', 'profile.identity.full_name'),
      ),
    );
    expect(result.data.profile).toEqual({ identity: { full_name: 'Primeiro-CANARY' } });
    expect(result.warnings.map((w) => w.code)).toEqual(['DUPLICATE_FIELD_IGNORED']);
    expect(JSON.stringify(result.warnings)).not.toContain('CANARY');
  });

  it('a blank first occurrence does not shadow a filled duplicate', () => {
    const result = parseOk(
      form(
        field('Nome', '`[Preencher]`', 'profile.identity.full_name'),
        field('Nome', 'Ana', 'profile.identity.full_name'),
      ),
    );
    expect(result.data.profile).toEqual({ identity: { full_name: 'Ana' } });
    expect(result.warnings).toEqual([]);
  });

  it('uses only the first of several annotations on one line', () => {
    const result = parseOk(
      form(
        '- **Nome:** Ana <!-- path: profile.identity.full_name --> <!-- path: profile.identity.city -->',
      ),
    );
    expect(result.data.profile).toEqual({ identity: { full_name: 'Ana' } });
    expect(result.warnings.map((w) => w.code)).toEqual(['DUPLICATE_FIELD_IGNORED']);
  });

  it('ignores annotations inside other (multi-line) HTML comments and reports an unterminated one', () => {
    const hidden = parseOk(
      form(
        field('Nome', 'Ana', 'profile.identity.full_name'),
        '<!--',
        field('Cidade', 'Escondida', 'profile.identity.city'),
        '-->',
        '<!-- comentario qualquer -->',
        '- **Região:** Sul <!-- nota --> <!-- path: profile.identity.region -->',
      ),
    );
    expect(hidden.data.profile).toEqual({ identity: { full_name: 'Ana', region: 'Sul' } });
    // a field commented out on purpose is reported (information), never applied
    expect(hidden.warnings.map((w) => [w.code, w.severity, w.path])).toEqual([
      ['UNKNOWN_KEY_UNMAPPED', 'info', 'markdown:line:5'],
    ]);

    // an opener without closer swallows text up to the next "-->" (HTML semantics) and says so
    const swallowed = parseOk(
      form(
        field('Nome', 'Ana', 'profile.identity.full_name'),
        '<!-- esquecido',
        field('Cidade', 'Escondida', 'profile.identity.city'),
      ),
    );
    expect(swallowed.data.profile).toEqual({ identity: { full_name: 'Ana' } });
    expect(swallowed.warnings.map((w) => w.path)).toEqual(['markdown:line:5']);

    // an opener that is never closed hides the rest of the file
    const open = parseOk(
      form(
        field('Nome', 'Ana', 'profile.identity.full_name'),
        '<!-- esquecido',
        '- **Cidade:** Escondida',
      ),
    );
    expect(open.data.profile).toEqual({ identity: { full_name: 'Ana' } });
    expect(open.warnings.map((w) => [w.code, w.path])).toEqual([
      ['UNKNOWN_KEY_UNMAPPED', 'markdown:line:4'],
    ]);
  });

  it('accepts lenient spelling of the anchor and rejects empty or spaced paths', () => {
    const result = parseOk(
      form(
        '- **Nome:** Ana <!--   PATH:   profile.identity.full_name   -->',
        '- **Cidade:** Rio <!-- path: -->',
        '- **Região:** Sul <!-- path: profile.identity.region extra -->',
      ),
    );
    expect(result.data.profile).toEqual({ identity: { full_name: 'Ana' } });
    expect(result.warnings.filter((w) => w.code === 'UNKNOWN_KEY_UNMAPPED')).toHaveLength(2);
  });

  it('flags field-looking lines without an anchor inside the form, but not template prose', () => {
    const result = parseOk(
      [
        '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->',
        '',
        '## Instruções',
        '',
        '- **Dica:** isto é prosa do formulário, fora de qualquer campo',
        '',
        '## Identificação',
        '',
        field('Nome', 'Ana', 'profile.identity.full_name'),
        '- **Hobby:** xadrez-CANARY',
        '- **Outro:** `[Preencher]`',
        field('Cidade', 'Rio', 'profile.identity.city'),
        'Linha solta logo abaixo do campo anterior',
        '',
        'Parágrafo normal depois de linha em branco',
      ].join('\n'),
    );
    expect(result.data.profile).toEqual({ identity: { full_name: 'Ana', city: 'Rio' } });
    const flagged = result.warnings.filter((w) => w.code === 'UNKNOWN_KEY_UNMAPPED');
    expect(flagged.map((w) => w.path)).toEqual(['markdown:line:10', 'markdown:line:13']);
    expect(JSON.stringify(result.warnings)).not.toContain('CANARY');
    expect(result.unmapped).toHaveLength(2);
  });
});

describe('untrusted content stays inert data', () => {
  it('keeps HTML and script payloads as plain text without interpreting them', () => {
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '[click](javascript:alert(1))',
      '<iframe src="https://example.test"></iframe>',
      '${process.env.SECRET}',
      '{{constructor.constructor("return 1")()}}',
    ];
    const lines = payloads.map((payload, index) =>
      field(`Campo ${index}`, payload, 'profile.statements[].text'),
    );
    const text = form(
      ...payloads
        .map((p, i) => [
          `## Texto — registro ${i + 1}`,
          field('Texto', p, 'profile.statements[].text'),
        ])
        .flat(),
    );
    expect(lines).toHaveLength(payloads.length);
    const statements = (profileOf(text).statements as Json[]).map((s) => s.text);
    expect(statements).toEqual(payloads);
  });

  it('does not echo file content in warnings or errors', () => {
    const canary = 'SEGREDO-CANARY-7731';
    const wrong = form(
      field('A', canary, 'profile.availability_preferences.willing_to_relocate'),
      field('B', canary, 'profile.courses[].workload_hours'),
      field('C', canary, 'profile.contact_points[].is_primary'),
      field('D', canary, 'profile.nao_existe'),
      field('E', `(prefiro não informar) ${canary}`, 'profile.identity.pronouns'),
      `- **F:** ${canary} <!-- path: profile.identity.city --> ${canary}`,
    );
    const result = parseProfileMarkdown(wrong);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.warnings)).not.toContain(canary);

    const imported = importProfile(
      form(
        field('Email', canary, 'profile.contact_points[].value'),
        field('Tipo', 'email', 'profile.contact_points[].kind'),
      ),
      { format: 'markdown' },
    );
    expect(imported.ok).toBe(false);
    expect(JSON.stringify(imported.report.errors)).not.toContain(canary);
    expect(JSON.stringify(imported.report.warnings)).not.toContain(canary);
  });
});

describe('errors and limits', () => {
  it('rejects empty input, whitespace-only input and a lone BOM', () => {
    for (const text of ['', '   \n\n', '\uFEFF', '\uFEFF\n']) {
      const result = parseProfileMarkdown(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe('EMPTY');
    }
  });

  it('rejects free Markdown (no anchors) and anchors that match nothing', () => {
    const free = parseProfileMarkdown('# Meu currículo\n\n- Nome: Ana\n- Cargo: Dev\n');
    expect(free.ok).toBe(false);
    if (!free.ok) expect(free.errors.map((e) => e.code)).toEqual(['NO_ANNOTATIONS']);
    const wrongPaths = parseProfileMarkdown('- **Nome:** Ana <!-- path: foo.bar -->\n');
    expect(wrongPaths.ok).toBe(false);
    if (!wrongPaths.ok) expect(wrongPaths.errors.map((e) => e.code)).toEqual(['NO_ANNOTATIONS']);
    const imported = loadProfile('# Meu currículo\n\n- Nome: Ana\n', { format: 'markdown' });
    expect(imported.ok).toBe(false);
    expect(imported.report.errors[0]?.code).toBe('NO_ANNOTATIONS');
  });

  it('enforces the byte limit on UTF-8 size, not on characters', () => {
    const text = form(field('Nome', 'é'.repeat(300), 'profile.identity.full_name'));
    expect(parseProfileMarkdown(text, { limits: { maxBytes: 400 } }).ok).toBe(false);
    const big = parseProfileMarkdown(`${form()}${'x'.repeat(3 * 1024 * 1024)}`);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.errors[0]?.code).toBe('TOO_LARGE');
  });

  it('enforces the string length limit per answer and per line', () => {
    const long = parseProfileMarkdown(
      form(field('Nome', 'a'.repeat(25_000), 'profile.identity.full_name')),
    );
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.errors[0]?.code).toBe('STRING_TOO_LONG');
    const wrapped = parseProfileMarkdown(
      [
        '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->',
        '- **Texto:** início <!-- path: profile.statements[].text -->',
        ...Array.from({ length: 5 }, () => `  ${'b'.repeat(5_000)}`),
      ].join('\n'),
    );
    expect(wrapped.ok).toBe(false);
    const list = parseProfileMarkdown(
      [
        '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->',
        '- **Aprendizados:** <!-- path: profile.experiences[].lessons_learned -->',
        ...Array.from({ length: 5 }, (_, i) => `  - item ${i} ${'c'.repeat(5_000)}`),
      ].join('\n'),
    );
    expect(list.ok).toBe(true); // lists are limited per line/item, not in total
  });

  it('enforces the node limit', () => {
    const lines = Array.from({ length: 50 }, (_, i) =>
      field('Id', `SKL-${i}`, 'profile.skills[].id'),
    );
    const result = parseProfileMarkdown(form(...lines), { limits: { maxNodes: 20 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain('TOO_MANY_NODES');
  });

  it('refuses a future or unreadable schema_version without echoing it', () => {
    const future = loadProfile(
      '**Versão:** 9.9.9 <!-- path: schema_version -->\n- **Nome:** Ana <!-- path: profile.identity.full_name -->\n',
    );
    expect(future.ok).toBe(false);
    expect(future.report.errors[0]?.code).toBe('VERSION_FUTURE');
    const garbage = parseOk(
      '**Versão:** SEGREDO-CANARY <!-- path: schema_version -->\n- **Nome:** Ana <!-- path: profile.identity.full_name -->\n',
    );
    expect(garbage.data.schema_version).toBe('2.1.0');
    expect(JSON.stringify(garbage.warnings)).not.toContain('CANARY');
    const blank = parseOk(
      '**Versão:** `[Preencher]` <!-- path: schema_version -->\n- **Nome:** Ana <!-- path: profile.identity.full_name -->\n',
    );
    expect(blank.data.schema_version).toBe('2.1.0');
    expect(blank.warnings.map((w) => w.code)).toEqual(['DEFAULTS_APPLIED']);
    const previous = loadProfile(
      '**Versão:** 2.0.0 <!-- path: schema_version -->\n- **Nome:** Ana <!-- path: profile.identity.full_name -->\n',
    );
    expect(previous.ok).toBe(true);
    expect(previous.document?.schema_version).toBe('2.1.0');
  });

  it('caps the number of warnings and unmapped entries in the report', () => {
    const lines = Array.from(
      { length: 1_000 },
      (_, i) => `- **X${i}:** valor <!-- path: nope.${i} -->`,
    );
    const result = parseOk(form(field('Nome', 'Ana', 'profile.identity.full_name'), ...lines));
    expect(result.warnings.length).toBeLessThan(150);
    expect(result.unmapped.length).toBe(200);
    expect(result.warnings.some((w) => w.path === null)).toBe(true);
  });
});

describe('line endings and encodings', () => {
  const text = form(
    '## Contato — registro 1',
    field('Valor', 'a@example.test', 'profile.contact_points[].value'),
    '## Contato — registro 2',
    field('Valor', 'b@example.test', 'profile.contact_points[].value'),
    '- **Texto:** linha 1 <!-- path: profile.statements[].text -->',
    '  linha 2',
  );
  const reference = profileOf(text);

  it.each([
    ['CRLF', text.replace(/\n/g, '\r\n')],
    ['lone CR (classic Mac)', text.replace(/\n/g, '\r')],
    ['UTF-8 BOM', `\uFEFF${text}`],
    ['CRLF with BOM', `\uFEFF${text.replace(/\n/g, '\r\n')}`],
    ['trailing spaces and tabs', text.replace(/\n/g, '   \n').replace('  linha 2', '\tlinha 2')],
  ])('gives the same result with %s', (_name, variant) => {
    expect(profileOf(variant)).toEqual(reference);
  });
});

describe('adversarial inputs finish quickly and safely', () => {
  const FAST_MS = 3_000;
  const timed = (text: string): number => {
    const started = performance.now();
    const result = parseProfileMarkdown(text);
    const elapsed = performance.now() - started;
    expect(typeof result.ok).toBe('boolean');
    return elapsed;
  };

  const header = '**Versão do modelo:** 2.1.0 <!-- path: schema_version -->\n';
  const size = 1_500_000;
  const hostile: [string, string][] = [
    ['unclosed comment openers', `${header}${'<!--'.repeat(size / 4)}`],
    ['comment openers with annotation prefixes', `${header}${'<!-- path:'.repeat(size / 9)}`],
    ['closers only', `${header}${'-->'.repeat(size / 3)}`],
    ['emphasis runs', `${header}- ${'**'.repeat(size / 2)}`],
    ['bold label that never closes', `${header}- **${'a'.repeat(size)}`],
    [
      'opening parentheses after a bold label',
      `${header}- **L** ${'('.repeat(size)}: x <!-- path: profile.identity.city -->`,
    ],
    ['backtick runs', `${header}- **L:** ${'`'.repeat(size)} <!-- path: profile.identity.city -->`],
    ['one huge line of spaces', `${header}${' '.repeat(size)}x`],
    ['a million blank lines', `${header}${'\n'.repeat(size)}`],
    [
      'indented lines after a field',
      `${header}- **L:** a <!-- path: profile.identity.city -->\n${'  x\n'.repeat(size / 4)}`,
    ],
    [
      'indented bullets in a list field',
      `${header}- **L:** <!-- path: profile.experiences[].lessons_learned -->\n${'  - x\n'.repeat(size / 6)}`,
    ],
    [
      'many tiny records',
      header + '- **I:** a <!-- path: profile.skills[].id -->\n'.repeat(size / 50),
    ],
    ['one hundred thousand unfinished bold labels', `${header}${'- **a (\n'.repeat(size / 20)}`],
    [
      'one hundred thousand openers that never close',
      `${header}${'<!-- path: profile.identity.city\n'.repeat(size / 40)}`,
    ],
    [
      'alternating comment openers and closers',
      `${header}${'<!-- --> <!-- path: x\n'.repeat(size / 25)}`,
    ],
    ['repeated heading words', `${header}# ${'registro '.repeat(size / 9)}`],
    [
      'deep brackets and separators',
      `${header}- **L:** ${'[;,'.repeat(size / 3)} <!-- path: profile.experiences[].lessons_learned -->`,
    ],
    [
      'numbers with many separators',
      `${header}- **H:** ${'1.'.repeat(size / 4)} <!-- path: profile.courses[].workload_hours -->`,
    ],
  ];

  it.each(hostile)('%s', (_name, text) => {
    expect(timed(text)).toBeLessThan(FAST_MS);
  });

  it('keeps the work linear: doubling the input does not quadruple the time', () => {
    const build = (n: number): string =>
      header + '- **I:** a <!-- path: profile.skills[].id -->\n'.repeat(n);
    timed(build(2_000)); // warm up
    const small = Math.max(timed(build(10_000)), 5);
    const large = timed(build(40_000));
    expect(large).toBeLessThan(small * 12);
  });
});

describe('import pipeline integration', () => {
  const sample = form(
    '## Contato — registro 1',
    field('Id local', 'CP-001', 'profile.contact_points[].id'),
    field('Tipo', 'email', 'profile.contact_points[].kind'),
    field('Valor', 'ana@example.test', 'profile.contact_points[].value'),
    '## Contato — registro 2',
    field('Tipo', 'phone', 'profile.contact_points[].kind'),
    field('Valor', '+55 (99) 90000-0102', 'profile.contact_points[].value'),
    field('Experiência id', 'EXP-001', 'profile.experiences[].id'),
    field('Cargo', 'Analista', 'profile.experiences[].official_title'),
    field('Início', '2020-01', 'profile.experiences[].start_date'),
    field('Fim', '2019-01', 'profile.experiences[].end_date'),
  );

  it('keeps contract validation: an end date before the start fails with a path, no content', () => {
    const result = importProfile(sample, { format: 'markdown' });
    expect(result.ok).toBe(false);
    expect(result.report.errors.map((e) => e.path)).toContain('profile.experiences[0].end_date');
    expect(result.preview).toBeNull();
  });

  it('imports a valid form: phone normalised, ids rewritten, review state set, source recorded', () => {
    const valid = sample.replace('2019-01', '2021-06');
    const result = importProfile(valid, {
      hint: { filename: 'perfil.md' },
      generateId: sequentialIds(),
    });
    expect(result.report.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const document = result.document;
    expect(document?.profile.contact_points?.map((c) => c.value)).toEqual([
      'ana@example.test',
      '+5599900000102',
    ]);
    expect(document?.profile.experiences?.[0]?.meta?.status).toBe('needs_review');
    expect(result.report.id_map).toHaveProperty('EXP-001');
    expect(result.report.source_format).toBe('markdown');
    expect(result.report.warnings.map((w) => w.code)).toContain('PHONE_NORMALIZED');
    expect(result.preview?.records.length).toBeGreaterThan(0);
  });

  it('autodetects markdown without any hint', () => {
    const result = loadProfile(sample.replace('2019-01', '2021-06'));
    expect(result.ok).toBe(true);
    expect(result.report.steps.map((s) => s.id)).toEqual(
      expect.arrayContaining(['parse_markdown', 'normalize', 'validate']),
    );
  });

  it('is deterministic: the same text always gives the same document', () => {
    const valid = sample.replace('2019-01', '2021-06');
    expect(loadProfile(valid).document).toEqual(loadProfile(valid).document);
  });
});
