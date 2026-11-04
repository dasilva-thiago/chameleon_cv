/**
 * Higiene das fixtures: sem PII real, canarios unicos e em campos privados, ids unicos e referencias
 * resolvidas, coerencia de contexto de uso (ADR-0007), enums canonicos (domain-model §2.4).
 *
 * TECNICA ANTI-PII (documentada no README): nenhum dado real do perfil-piloto e colado no repositorio.
 * As varreduras usam padroes GENERICOS:
 *   - provedores de e-mail pessoal (gmail.com etc.) e qualquer e-mail fora de example.invalid/example.test;
 *   - o prefixo de telefone "(12) 9" da regiao do piloto, e qualquer telefone fora do formato claramente falso
 *     (DDD "00", numero 90000-01xx, ou faixa ficticia 555-01xx);
 *   - o primeiro nome do piloto e o handle derivado, como regex parcial;
 *   - nomes de organizacoes/projetos do piloto que o proprio plano cita (documentados em docs/), e padroes de
 *     CPF/CNPJ;
 *   - todo host de URL precisa ser reservado (RFC 2606: .test, .invalid, example.*).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CANARY_PATTERN,
  EDGE_PROFILES,
  JOB_IDS,
  JOBS_DIR,
  PROFILES,
  PROFILES_DIR,
  canarySlug,
  edgeProfilePath,
  extractCanaries,
  listCanaries,
  listProfileCanaries,
  loadProfile,
  type ProfileId,
} from '../src/index';
import {
  SOURCE_COLLECTION,
  collectIds,
  isRec,
  listOf,
  metaOf,
  str,
  usagesOf,
  walk,
  type PathPart,
  type Rec,
  type SkillUsageSourceKey,
} from './support';

interface FixtureFile {
  readonly kind: 'profile' | 'edge' | 'job' | 'job-meta';
  readonly id: string;
  readonly file: string;
  readonly text: string;
}

function readAll(): FixtureFile[] {
  const files: FixtureFile[] = [];
  for (const p of PROFILES) {
    const file = join(PROFILES_DIR, `${p.id}.yaml`);
    files.push({ kind: 'profile', id: p.id, file, text: readFileSync(file, 'utf8') });
  }
  for (const e of EDGE_PROFILES) {
    const file = edgeProfilePath(e.id);
    files.push({ kind: 'edge', id: e.id, file, text: readFileSync(file, 'utf8') });
  }
  for (const id of JOB_IDS) {
    const txt = join(JOBS_DIR, `${id}.txt`);
    const meta = join(JOBS_DIR, `${id}.meta.json`);
    files.push({ kind: 'job', id, file: txt, text: readFileSync(txt, 'utf8') });
    files.push({ kind: 'job-meta', id, file: meta, text: readFileSync(meta, 'utf8') });
  }
  return files;
}

const ALL = readAll();

// ---------------------------------------------------------------------------------------------
// Sem PII real
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'primeiro nome do piloto', re: /thiago/i },
  { name: 'handle derivado do piloto', re: /dasilva|da[\s._-]?silva[._-]?thiago/i },
  {
    name: 'provedor de e-mail pessoal',
    re: /@(?:gmail|googlemail|hotmail|outlook|live|yahoo|icloud|proton(?:mail)?|uol|bol)\./i,
  },
  {
    name: 'prefixo de telefone do piloto "(12) 9"',
    re: /(?:\(\s*12\s*\)|\+55\s*12\b|\b012\b)[\s.-]*9\d{3,4}/,
  },
  {
    name: 'organizacoes/projetos do piloto citados no plano',
    re: /eduassets|\bproati\b|gestor\s*seller/i,
  },
  { name: 'CPF', re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/ },
  { name: 'CNPJ', re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/ },
  { name: 'nome do arquivo base do piloto', re: /BASE_DE_DADOS_CURRICULO/i },
];

const ALLOWED_EMAIL_DOMAIN = /@(?:[a-z0-9-]+\.)*(?:example\.invalid|example\.test)$/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;
const RESERVED_HOST =
  /(?:^|\.)(?:example\.(?:com|org|net|invalid|test)|[a-z0-9-]+\.test|[a-z0-9-]+\.invalid)$/i;

/** Telefones sinteticos: DDD 00 (invalido), numero 90000-01xx; PT 000 000 1xx; EUA 555-01xx. */
/** Aceita a forma formatada (entrada) e a canonica (`+` e digitos, gravada pelo importador 2.1.0). */
const FAKE_PHONE =
  /^(?:\+55 \(00\) 90000-01\d\d|\+351 000 000 \d{3}|\+1 \(\d{3}\) 555-01\d\d|\+55009000001\d\d|\+351000000\d{3}|\+1\d{3}55501\d\d)$/;

describe('sem PII real nas fixtures', () => {
  it.each(FORBIDDEN_PATTERNS.map((p) => [p.name, p.re] as const))(
    'nenhum arquivo contem: %s',
    (_name, re) => {
      const hits = ALL.filter((f) => re.test(f.text)).map((f) => `${f.kind}:${f.id}`);
      expect(hits).toEqual([]);
    },
  );

  it('todo e-mail usa example.invalid ou example.test', () => {
    const bad: string[] = [];
    for (const f of ALL) {
      for (const email of f.text.match(EMAIL_RE) ?? []) {
        if (!ALLOWED_EMAIL_DOMAIN.test(email)) bad.push(`${f.id}: ${email}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('todo host de URL e reservado (RFC 2606)', () => {
    const bad: string[] = [];
    for (const f of ALL) {
      for (const url of f.text.match(URL_RE) ?? []) {
        const host = /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1] ?? '';
        if (!RESERVED_HOST.test(host)) bad.push(`${f.id}: ${url}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('todo telefone de contato tem o formato claramente falso', () => {
    const bad: string[] = [];
    for (const p of PROFILES) {
      walk(loadProfile(p.id), ({ value }) => {
        if (isRec(value) && value.kind === 'phone' && typeof value.value === 'string') {
          if (!FAKE_PHONE.test(value.value)) bad.push(`${p.id}: ${value.value}`);
        }
      });
    }
    // legado: contact.phone
    const legacy = loadProfile('legacy-1.0.0-filled');
    const phone =
      isRec(legacy.profile) && isRec(legacy.profile.contact)
        ? str(legacy.profile.contact.phone)
        : null;
    if (phone && !FAKE_PHONE.test(phone)) bad.push(`legacy: ${phone}`);
    expect(bad).toEqual([]);
  });

  it('nenhum perfil reutiliza o nome completo de outro', () => {
    const names = PROFILES.map((p) => {
      const identity = (loadProfile(p.id).profile as Rec).identity as Rec;
      return str(identity.full_name);
    });
    expect(new Set(names).size).toBe(names.length);
  });

  it('a lista de padroes proibidos funciona (autoteste dos detectores)', () => {
    const sample = (name: string): string =>
      ({
        'primeiro nome do piloto': 'Fulano Thiago Beltrano',
        'provedor de e-mail pessoal': 'alguem@gmail.com',
        'prefixo de telefone do piloto "(12) 9"': 'Tel (12) 98888-7777',
        CPF: '123.456.789-09',
      })[name] ?? '';
    for (const { name, re } of FORBIDDEN_PATTERNS) {
      const text = sample(name);
      if (text) expect(re.test(text), name).toBe(true);
    }
    expect(ALLOWED_EMAIL_DOMAIN.test('x@mail.example.invalid')).toBe(true);
    expect(ALLOWED_EMAIL_DOMAIN.test('x@example.com')).toBe(false);
    expect(FAKE_PHONE.test('+55 (12) 99999-0000')).toBe(false);
    expect(FAKE_PHONE.test('+55 (00) 90000-0101')).toBe(true);
    expect(FAKE_PHONE.test('+5500900000101')).toBe(true);
    expect(FAKE_PHONE.test('+5511999990000')).toBe(false);
    expect(RESERVED_HOST.test('git.example.test')).toBe(true);
    expect(RESERVED_HOST.test('github.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Canarios
// ---------------------------------------------------------------------------------------------

/** Chaves cujo conteudo e privado por construcao (domain-model §2.3). */
const PRIVATE_KEYS_V2 = new Set([
  'private_notes',
  'exit_reason',
  'pronouns',
  'availability_preferences',
  'career_preferences',
  'usage_rules',
]);
const PRIVATE_KEYS_V1 = new Set([
  ...PRIVATE_KEYS_V2,
  'exit_reason_private', // v1: nome legado do exit_reason
  'career_narrative', // v1: vira statement privado por padrao na migracao
]);

function isPrivateRecord(node: unknown): boolean {
  if (!isRec(node)) return false;
  const meta = metaOf(node);
  return (
    ['private', 'conditional'].includes(String(node.visibility)) ||
    ['private', 'conditional'].includes(String(meta.visibility)) ||
    ['never', 'requires_approval'].includes(String(meta.resume_use)) ||
    meta.status === 'archived' ||
    (node.is_public === false &&
      ['not_allowed', 'restricted'].includes(String(node.recruiter_sharing)))
  );
}

function isPrivateLocation(
  path: readonly PathPart[],
  ancestors: readonly unknown[],
  keys: ReadonlySet<string>,
): boolean {
  return path.some((p) => keys.has(String(p))) || ancestors.some((a) => isPrivateRecord(a));
}

describe('canarios', () => {
  const profileCanaries = listCanaries().filter((c) => c.fixtureKind === 'profile');

  it('todo canario e unico no repositorio de fixtures (aparece 1 vez em 1 arquivo)', () => {
    const occurrences = new Map<string, string[]>();
    // *.meta.json de vagas repete o canario de injecao como marcador proibido (forbidden_output_markers).
    for (const f of ALL.filter((x) => x.kind !== 'job-meta')) {
      for (const canary of extractCanaries(f.text)) {
        occurrences.set(canary, [...(occurrences.get(canary) ?? []), `${f.kind}:${f.id}`]);
      }
    }
    const repeated = [...occurrences.entries()].filter(([, where]) => where.length > 1);
    expect(repeated).toEqual([]);
    expect(occurrences.size).toBeGreaterThan(40);
  });

  it('um canario nao e prefixo de outro (busca por substring nao gera falso positivo)', () => {
    const all = listCanaries().map((c) => c.canary);
    const clashes: string[] = [];
    for (const a of all)
      for (const b of all) if (a !== b && b.startsWith(a)) clashes.push(`${a} < ${b}`);
    expect(clashes).toEqual([]);
  });

  it('canarios de perfil seguem CANARY-<slug-da-fixture>-<campo>', () => {
    const bad = profileCanaries.filter(
      (c) => !c.canary.startsWith(`CANARY-${canarySlug(c.fixtureId)}-`),
    );
    expect(bad).toEqual([]);
    for (const c of profileCanaries) expect(c.canary).toMatch(/^CANARY-[A-Za-z0-9-]+-[a-z0-9_]+$/);
  });

  it('o padrao de extracao captura o token inteiro', () => {
    expect('x CANARY-private-heavy-private_note_1 y'.match(CANARY_PATTERN)).toEqual([
      'CANARY-private-heavy-private_note_1',
    ]);
  });

  it.each(PROFILES.map((p) => [p.id] as const))('%s: tem >= 2 canarios', (id) => {
    expect(listProfileCanaries(id).length).toBeGreaterThanOrEqual(2);
  });

  it('private-heavy tem >= 15 canarios cobrindo cada tipo de dado privado', () => {
    const canaries = listProfileCanaries('private-heavy');
    expect(canaries.length).toBeGreaterThanOrEqual(15);
    for (const field of [
      'pronouns',
      'contact_private_label',
      'contact_conditional_label',
      'career_narrative',
      'conditional_statement',
      'exit_reason',
      'never_org',
      'never_item',
      'conditional_item',
      'archived_item',
      'private_project',
      'salary_notes',
      'deal_breaker',
      'work_condition',
      'excluded_industry',
      'restricted_term',
      'evidence_location',
    ]) {
      expect(canaries, field).toContain(`CANARY-private-heavy-${field}`);
    }
  });

  it('canarios so aparecem em locais privados (nunca em campos publicos que vao ao documento)', () => {
    const leaks: string[] = [];
    for (const info of PROFILES) {
      const keys = info.format === 'v1' ? PRIVATE_KEYS_V1 : PRIVATE_KEYS_V2;
      walk(loadProfile(info.id), ({ value, path, ancestors }) => {
        if (typeof value === 'string' && extractCanaries(value).length > 0) {
          if (!isPrivateLocation(path, ancestors, keys))
            leaks.push(`${info.id}: ${path.join('.')}`);
        }
      });
    }
    expect(leaks).toEqual([]);
  });

  it('o detector de local privado reconhece publico x privado (autoteste)', () => {
    expect(
      isPrivateLocation(
        ['profile', 'experiences', 0, 'meta', 'private_notes'],
        [],
        PRIVATE_KEYS_V2,
      ),
    ).toBe(true);
    expect(
      isPrivateLocation(
        ['profile', 'experiences', 0, 'official_title'],
        [{ meta: {} }],
        PRIVATE_KEYS_V2,
      ),
    ).toBe(false);
    expect(
      isPrivateLocation(['a', 'text'], [{ meta: { visibility: 'conditional' } }], PRIVATE_KEYS_V2),
    ).toBe(true);
  });

  it('o canario da vaga de injecao e o unico canario fora de perfis', () => {
    const jobCanaries = listCanaries().filter((c) => c.fixtureKind === 'job');
    expect(jobCanaries).toEqual([
      { canary: 'CANARY-injection-payload', fixtureKind: 'job', fixtureId: 'injection' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Ids, referencias e coerencia (somente formato v2 + checagens basicas no legado)
// ---------------------------------------------------------------------------------------------

const V2 = PROFILES.filter((p) => p.format === 'v2').map((p) => p.id);

function profileRec(id: ProfileId): Rec {
  const profile = loadProfile(id).profile;
  if (!isRec(profile)) throw new Error(`${id}: profile ausente`);
  return profile;
}

describe('ids e integridade referencial', () => {
  it.each(PROFILES.map((p) => [p.id] as const))('%s: ids unicos no documento', (id) => {
    const ids = collectIds(loadProfile(id));
    const seen = new Map<string, string>();
    const dups: string[] = [];
    for (const { id: value, path } of ids) {
      if (seen.has(value)) dups.push(`${value} (${seen.get(value)} e ${path})`);
      else seen.set(value, path);
    }
    expect(dups).toEqual([]);
    expect(ids.length).toBeGreaterThan(0);
  });

  it.each(V2.map((id) => [id] as const))('%s: toda referencia por id resolve', (id) => {
    const doc = loadProfile(id);
    const profile = profileRec(id);
    const all = new Set(collectIds(doc).map((x) => x.id));
    const evidenceIds = new Set(listOf(profile, 'evidence').map((e) => String(e.id)));
    const skillIds = new Set(listOf(profile, 'skills').map((s) => String(s.id)));
    const problems: string[] = [];

    walk(profile, ({ value, path }) => {
      const key = String(path[path.length - 1]);
      const where = path.join('.');
      if (key === 'evidence_ids' && Array.isArray(value)) {
        for (const ref of value)
          if (!evidenceIds.has(String(ref))) problems.push(`${where}: ${String(ref)}`);
      }
      if (key === 'supports' && Array.isArray(value)) {
        for (const ref of value)
          if (!all.has(String(ref))) problems.push(`${where}: ${String(ref)}`);
      }
      if (key === 'related_skill_ids' && Array.isArray(value)) {
        for (const ref of value)
          if (!skillIds.has(String(ref))) problems.push(`${where}: ${String(ref)}`);
      }
      if (
        ['related_experience_id', 'related_education_id'].includes(key) &&
        typeof value === 'string'
      ) {
        if (!all.has(value)) problems.push(`${where}: ${value}`);
      }
      if (key === 'target' && isRec(value) && typeof value.record_id === 'string') {
        if (!all.has(value.record_id)) problems.push(`${where}.record_id: ${value.record_id}`);
      }
    });

    for (const usage of usagesOf(profile)) {
      if (!skillIds.has(String(usage.skill_id))) problems.push(`${String(usage.id)}.skill_id`);
    }
    expect(problems).toEqual([]);
  });

  it.each(V2.map((id) => [id] as const))(
    '%s: contexto de uso e fonte coerentes (ADR-0007)',
    (id) => {
      const profile = profileRec(id);
      const problems: string[] = [];
      const ids = (collection: string): Set<string> =>
        new Set(listOf(profile, collection).map((r) => String(r.id)));

      for (const usage of usagesOf(profile)) {
        const uid = String(usage.id);
        const context = String(usage.usage_context);
        // contrato 2.0.0: a fonte e um campo `*_id` no proprio registro (nao ha objeto `source`)
        const source: Rec = {};
        for (const key of Object.keys(SOURCE_COLLECTION) as SkillUsageSourceKey[]) {
          if (usage[key] !== undefined && usage[key] !== null) source[key] = usage[key];
        }
        const keys = Object.keys(source) as SkillUsageSourceKey[];
        if (keys.length > 1) problems.push(`${uid}: mais de uma fonte`);
        for (const key of keys) {
          const collection = SOURCE_COLLECTION[key];
          if (!collection) problems.push(`${uid}: fonte desconhecida ${key}`);
          else if (!ids(collection).has(String(source[key]))) {
            problems.push(`${uid}: ${key}=${String(source[key])} nao existe`);
          }
        }
        const has = (k: SkillUsageSourceKey): boolean => keys.includes(k);
        if (context === 'professional_experience' && !has('experience_id'))
          problems.push(`${uid}: professional sem experiencia`);
        if (context === 'project_experience' && !has('project_id'))
          problems.push(`${uid}: projeto sem project_id`);
        if (context === 'coursework' && !(has('education_id') || has('course_id')))
          problems.push(`${uid}: coursework sem fonte`);
        if (context === 'certification' && !has('certification_id'))
          problems.push(`${uid}: certification sem fonte`);
        if (
          context === 'volunteer_experience' &&
          !(has('volunteering_id') || has('experience_id'))
        ) {
          problems.push(`${uid}: volunteer sem fonte`);
        }
        if (
          ['self_declared_knowledge', 'conceptual_familiarity', 'unverified'].includes(context) &&
          keys.length > 0
        ) {
          problems.push(`${uid}: ${context} nao deveria ter fonte`);
        }
        if (context === 'project_experience' && keys.some((k) => k !== 'project_id')) {
          problems.push(`${uid}: project_experience com fonte que nao e projeto`);
        }
        if (context === 'professional_experience' && keys.some((k) => k !== 'experience_id')) {
          problems.push(`${uid}: professional_experience com fonte que nao e experiencia`);
        }
      }
      expect(problems).toEqual([]);
    },
  );

  it('os 8 contextos de uso (ADR-0007) aparecem em pelo menos uma fixture', () => {
    const seen = new Set<string>();
    for (const id of V2)
      for (const usage of usagesOf(profileRec(id))) seen.add(String(usage.usage_context));
    expect([...seen].sort()).toEqual(
      [
        'professional_experience',
        'project_experience',
        'volunteer_experience',
        'coursework',
        'certification',
        'self_declared_knowledge',
        'conceptual_familiarity',
        'unverified',
      ].sort(),
    );
  });

  it('os 4 status de fato e as 3 visibilidades e os 3 usos de curriculo aparecem', () => {
    const status = new Set<string>();
    const visibility = new Set<string>();
    const resumeUse = new Set<string>();
    for (const id of V2) {
      walk(profileRec(id), ({ value }) => {
        if (isRec(value) && isRec(value.meta)) {
          const m = value.meta;
          if (typeof m.status === 'string') status.add(m.status);
          if (typeof m.visibility === 'string') visibility.add(m.visibility);
          if (typeof m.resume_use === 'string') resumeUse.add(m.resume_use);
        }
      });
    }
    expect([...status].sort()).toEqual(['archived', 'confirmed', 'conflicting', 'needs_review']);
    expect([...visibility].sort()).toEqual(['conditional', 'private', 'public']);
    expect([...resumeUse].sort()).toEqual(['allowed', 'never', 'requires_approval']);
  });
});

describe('enums canonicos (docs/domain-model.md §2.4) nas fixtures v2', () => {
  const ENUMS: Record<string, readonly string[]> = {
    employment_type: [
      'employee',
      'internship',
      'apprenticeship',
      'contractor',
      'freelance',
      'self_employed',
      'business_owner',
      'temporary',
      'public_service',
      'volunteer',
      'other',
    ],
    current_seniority: [
      'student',
      'entry',
      'junior',
      'mid',
      'senior',
      'specialist',
      'lead',
      'manager',
      'executive',
      'not_assessed',
    ],
    self_assessed_level: [
      'not_assessed',
      'exposure',
      'basic',
      'intermediate',
      'advanced',
      'expert',
    ],
    category_project: [
      'personal',
      'academic',
      'open_source',
      'freelance',
      'professional',
      'research',
      'volunteer',
      'entrepreneurial',
      'other',
    ],
    language_level: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native', 'not_assessed'],
    pending_reason: ['missing', 'conflict', 'stale', 'unclear'],
    pending_status: ['open', 'resolved', 'dismissed'],
    evidence_type: [
      'repository',
      'certificate',
      'portfolio',
      'document',
      'publication',
      'demo',
      'reference',
      'self_declaration',
      'other',
    ],
    recruiter_sharing: ['allowed', 'restricted', 'not_allowed'],
    field_state: [
      'not_provided',
      'not_applicable',
      'not_assessed',
      'declined',
      'needs_confirmation',
    ],
    restriction_rule: ['never_include', 'require_approval', 'private_guidance_only'],
  };

  it.each(V2.map((id) => [id] as const))('%s: valores de enum validos', (id) => {
    const profile = profileRec(id);
    const bad: string[] = [];
    const check = (name: string, value: unknown, where: string): void => {
      if (value === undefined || value === null) return;
      if (typeof value !== 'string' || !ENUMS[name]?.includes(value)) {
        bad.push(`${where}: ${name}=${JSON.stringify(value)}`);
      }
    };
    for (const e of listOf(profile, 'experiences'))
      check('employment_type', e.employment_type, String(e.id));
    const positioning = isRec(profile.positioning) ? profile.positioning : {};
    check('current_seniority', positioning.current_seniority, 'positioning');
    for (const s of listOf(profile, 'skills'))
      check('self_assessed_level', s.self_assessed_level, String(s.id));
    for (const p of listOf(profile, 'projects'))
      check('category_project', p.category, String(p.id));
    for (const l of listOf(profile, 'languages')) {
      for (const k of ['overall_level', 'reading', 'writing', 'listening', 'speaking'])
        check('language_level', l[k], `${String(l.id)}.${k}`);
    }
    for (const pi of listOf(profile, 'pending_items')) {
      check('pending_reason', pi.reason, String(pi.id));
      check('pending_status', pi.status, String(pi.id));
    }
    for (const ev of listOf(profile, 'evidence')) {
      check('evidence_type', ev.type, String(ev.id));
      check('recruiter_sharing', ev.recruiter_sharing, String(ev.id));
    }
    const rules = isRec(profile.usage_rules) ? profile.usage_rules : {};
    for (const r of listOf(rules, 'restrictions')) check('restriction_rule', r.rule, 'usage_rules');
    walk(profile, ({ value, path }) => {
      if (path[path.length - 1] === 'field_states' && isRec(value)) {
        for (const state of Object.values(value)) check('field_state', state, path.join('.'));
      }
    });
    expect(bad).toEqual([]);
  });

  it.each(V2.map((id) => [id] as const))('%s: datas em PartialDate, end aceita present', (id) => {
    const bad: string[] = [];
    const PARTIAL = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;
    walk(profileRec(id), ({ value, path }) => {
      const key = String(path[path.length - 1]);
      if (path.includes('field_states')) return;
      if (
        [
          'start_date',
          'end_date',
          'completion_date',
          'expected_completion_date',
          'issue_date',
          'expiration_date',
          'evidence_date',
          'date',
        ].includes(key) &&
        typeof value === 'string' &&
        !(key === 'end_date' && value === 'present') &&
        !PARTIAL.test(value)
      ) {
        bad.push(`${path.join('.')}: ${value}`);
      }
    });
    expect(bad).toEqual([]);
  });

  it('nenhuma fixture v2 usa os defaults com aparencia de fato do 1.0.0 (is_current, fact_status, usage_context legado)', () => {
    for (const id of V2) {
      const text = JSON.stringify(loadProfile(id));
      expect(text, id).not.toContain('"fact_status"');
      expect(text, id).not.toContain('"is_current"');
      expect(text, id).not.toContain('"acquisition_contexts"');
      expect(text, id).not.toContain('"processing_consent"');
    }
  });
});
