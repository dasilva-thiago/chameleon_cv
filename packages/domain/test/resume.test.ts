import {
  EMPTY_REVIEW,
  cloneJson,
  parseProfileDocument,
  resumeContentSchema,
  type ProfileDocument,
  type ResumeContent,
} from '@chameleon/contracts';
import { describe, expect, it } from 'vitest';
import { analyzeJob, generateResume, reconcileOrigins, validateResume } from '../src';

const id = (n: number): string => `0190a8f0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const confirmed = { status: 'confirmed' };

const EXP = id(1);
const EXP_ITEM_OK = id(2);
const EXP_ITEM_PENDING = id(3);
const EXP_ITEM_OTHER = id(4);
const SKILL_NODE = id(5);
const SKILL_WEAK = id(6);
const USAGE_WEAK = id(7);
const PROJECT = id(8);
const EDU = id(9);
const CERT = id(10);
const LANG = id(11);
const SUMMARY = id(12);
const EMAIL = id(13);
const PHONE = id(14);
const PENDING_EXP = id(15);

function profile(overrides: Record<string, unknown> = {}): ProfileDocument {
  return parseProfileDocument({
    schema_version: '2.1.0',
    profile: {
      identity: {
        full_name: 'Ana Teste',
        city: 'Curitiba',
        region: 'PR',
        field_visibility: { region: 'private' },
      },
      positioning: { professional_headline: 'Pessoa desenvolvedora backend' },
      contact_points: [
        { id: EMAIL, kind: 'email', value: 'ana@example.test', visibility: 'public' },
        { id: PHONE, kind: 'phone', value: '+55 41 99999-0000', visibility: 'private' },
      ],
      statements: [
        { id: SUMMARY, kind: 'short_summary', text: 'Backend com foco em APIs.', meta: confirmed },
      ],
      experiences: [
        {
          id: EXP,
          official_title: 'Desenvolvedora Backend',
          organization_name: 'Acme',
          start_date: '2022-03',
          end_date: 'present',
          meta: confirmed,
          items: [
            {
              id: EXP_ITEM_OTHER,
              kind: 'responsibility',
              text: 'Manteve rotinas de deploy.',
              meta: confirmed,
            },
            {
              id: EXP_ITEM_OK,
              kind: 'achievement',
              text: 'Criou APIs REST em Node.js.',
              meta: confirmed,
            },
            {
              id: EXP_ITEM_PENDING,
              kind: 'achievement',
              text: 'Reduziu custos em 40%.',
              meta: { status: 'needs_review' },
            },
          ],
        },
        {
          id: PENDING_EXP,
          official_title: 'Cargo não confirmado',
          meta: { status: 'needs_review' },
        },
      ],
      skills: [
        { id: SKILL_NODE, name: 'Node.js', meta: confirmed },
        { id: SKILL_WEAK, name: 'Rust', meta: confirmed },
      ],
      skill_usages: [
        {
          id: USAGE_WEAK,
          skill_id: SKILL_WEAK,
          usage_context: 'conceptual_familiarity',
          meta: confirmed,
        },
      ],
      projects: [{ id: PROJECT, name: 'Painel de métricas', role: 'Autora', meta: confirmed }],
      education: [
        {
          id: EDU,
          course_name: 'Sistemas de Informação',
          institution: 'UFPR',
          start_date: '2019',
          completion_date: '2023',
          meta: confirmed,
        },
      ],
      certifications: [
        { id: CERT, name: 'AWS Cloud Practitioner', issuer: 'AWS', meta: confirmed },
      ],
      languages: [
        { id: LANG, language: 'Inglês', self_described_level: 'avançado', meta: confirmed },
      ],
      ...overrides,
    },
  });
}

const generate = (
  doc = profile(),
  options: Parameters<typeof generateResume>[1] = { analysis: null, review: EMPTY_REVIEW },
) => generateResume(doc, options);

const bulletsOf = (content: ResumeContent, kind: string) =>
  content.sections.find((s) => s.kind === kind)?.entries.flatMap((e) => e.bullets) ?? [];

describe('generateResume', () => {
  const { content, notes } = generate();

  it('produces a valid document with provenance on every entry and bullet', () => {
    expect(() => resumeContentSchema.parse(content)).not.toThrow();
    for (const section of content.sections) {
      for (const entry of section.entries) {
        expect(entry.sourceIds.length, `${section.id}/${entry.id}`).toBeGreaterThan(0);
        for (const bullet of entry.bullets) {
          expect(bullet.sourceIds.length).toBeGreaterThan(0);
          expect(bullet.origin).toBe('generated');
        }
      }
    }
    expect(validateResume(content, profile())).toEqual([]);
    expect(notes).toEqual([]);
  });

  it('is deterministic', () => {
    expect(generate()).toEqual({ content, notes });
  });

  it('header: name, headline, only non-private location parts and only public contacts', () => {
    expect(content.header).toMatchObject({
      name: 'Ana Teste',
      headline: 'Pessoa desenvolvedora backend',
      location: 'Curitiba',
    });
    expect(content.header.contacts.map((c) => c.value)).toEqual(['ana@example.test']);
    expect(JSON.stringify(content)).not.toContain('99999');
  });

  it('copies text verbatim from confirmed facts only; unconfirmed facts never appear', () => {
    const texts = bulletsOf(content, 'experience').map((b) => b.text);
    expect(texts).toContain('Criou APIs REST em Node.js.');
    expect(JSON.stringify(content)).not.toMatch(/40%|Cargo não confirmado/);
    const entry = content.sections.find((s) => s.kind === 'experience')?.entries[0];
    expect(entry).toMatchObject({
      heading: 'Desenvolvedora Backend',
      subheading: 'Acme',
      period: '03/2022 – Atual',
      sourceIds: [EXP],
    });
  });

  it('weak skills (conceptual familiarity only) are left out unless the owner pins them', () => {
    expect(bulletsOf(content, 'skills').map((b) => b.text)).toEqual(['Node.js']);
    const pinned = generate(profile(), {
      analysis: null,
      review: { ...EMPTY_REVIEW, pinnedRecordIds: [SKILL_WEAK] },
    }).content;
    expect(bulletsOf(pinned, 'skills').map((b) => b.text)).toEqual(['Rust', 'Node.js']);
  });

  it('the owner review hides excluded records everywhere', () => {
    const hidden = generate(profile(), {
      analysis: null,
      review: { ...EMPTY_REVIEW, excludedRecordIds: [EXP_ITEM_OK, CERT, EMAIL] },
    }).content;
    const text = JSON.stringify(hidden);
    expect(text).not.toContain('Criou APIs');
    expect(text).not.toContain('AWS Cloud');
    expect(hidden.header.contacts).toEqual([]);
  });

  it('the analysis plan orders what is shown first', () => {
    const analysis = analyzeJob('Requisitos\n- Node.js e APIs REST', profile());
    const planned = generate(profile(), { analysis, review: EMPTY_REVIEW }).content;
    const first = bulletsOf(planned, 'experience')[0];
    expect(first?.sourceIds).toEqual([EXP_ITEM_OK]);
  });

  it('English output uses English section titles; limits drop long texts with a note', () => {
    const en = generate(profile(), {
      analysis: null,
      review: EMPTY_REVIEW,
      language: 'en-US',
    }).content;
    expect(en.sections.map((s) => s.title)).toContain('Professional experience');
    const long = profile({
      statements: [{ id: SUMMARY, kind: 'short_summary', text: 'x'.repeat(601), meta: confirmed }],
    });
    const out = generate(long);
    expect(out.content.sections.some((s) => s.kind === 'summary')).toBe(false);
    expect(out.notes.join(' ')).toMatch(/resumo foi omitido/i);
  });

  it('a profile with many skills still yields a valid document (skills are capped, not rejected)', () => {
    const many = profile({
      skills: Array.from({ length: 40 }, (_, n) => ({
        id: id(500 + n),
        name: `Skill ${String(n)}`,
        meta: confirmed,
      })),
      skill_usages: [],
    });
    const out = generate(many).content;
    expect(() => resumeContentSchema.parse(out)).not.toThrow();
    expect(bulletsOf(out, 'skills')).toHaveLength(20);
  });

  it('an empty profile yields no sections and says why', () => {
    const empty = generate(parseProfileDocument({ schema_version: '2.1.0', profile: {} }));
    expect(empty.content.sections).toEqual([]);
    expect(empty.notes.join(' ')).toMatch(/Nenhum item confirmado/);
    expect(validateResume(empty.content, profile()).map((i) => i.code)).toContain('EMPTY_CONTENT');
  });
});

describe('validateResume', () => {
  const base = (): ResumeContent => cloneJson(generate().content);

  it('flags missing, unknown and unusable sources as blocking errors', () => {
    const content = base();
    const entry = content.sections.find((s) => s.kind === 'experience')?.entries[0];
    if (!entry) throw new Error('no entry');
    entry.bullets[0]!.sourceIds = [];
    entry.bullets[1]!.sourceIds = [id(999)];
    entry.sourceIds = [PENDING_EXP];
    const codes = validateResume(content, profile()).map((i) => `${i.severity}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'error:NO_SOURCE',
        'error:UNKNOWN_SOURCE',
        'error:SOURCE_NOT_USABLE',
      ]),
    );
  });

  it('a source that stopped being usable (profile changed later) blocks approval', () => {
    const content = base();
    const changed = profile({
      skills: [
        { id: SKILL_NODE, name: 'Node.js', meta: { status: 'needs_review' } },
        { id: SKILL_WEAK, name: 'Rust', meta: confirmed },
      ],
    });
    expect(validateResume(content, changed).some((i) => i.code === 'SOURCE_NOT_USABLE')).toBe(true);
  });

  it('edited text with numbers or technologies absent from the sources is only a warning', () => {
    const content = base();
    const bullet = bulletsOf(content, 'experience')[0];
    if (!bullet) throw new Error('no bullet');
    bullet.text = 'Liderou 12 pessoas com Kubernetes e reduziu custos em 40%.';
    bullet.origin = 'edited';
    const issues = validateResume(content, profile());
    expect(issues.every((i) => i.severity === 'warning')).toBe(true);
    expect(issues[0]).toMatchObject({ code: 'UNSUPPORTED_TERM' });
    expect(issues[0]?.message).toMatch(/Kubernetes/);
    // the same text marked as generated is not second-guessed (the server never lets edits claim that)
  });

  it('a changed heading that no source supports is a warning', () => {
    const content = base();
    const entry = content.sections.find((s) => s.kind === 'experience')?.entries[0];
    if (!entry) throw new Error('no entry');
    entry.heading = 'Diretora de Engenharia';
    expect(validateResume(content, profile()).map((i) => i.code)).toContain('UNSUPPORTED_TERM');
  });

  it('duplicate ids are errors', () => {
    const content = base();
    const bullets = content.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets));
    if (bullets.length < 2) throw new Error('need two bullets');
    bullets[1]!.id = bullets[0]!.id;
    expect(validateResume(content, profile()).map((i) => i.code)).toContain('DUPLICATE_ID');
  });
});

describe('reconcileOrigins', () => {
  it('marks edited, new and untouched bullets so an edit cannot pass as generated', () => {
    const previous = generate().content;
    const next = cloneJson(previous);
    const all = next.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets));
    all[0]!.text = 'Texto alterado.';
    all[1]!.origin = 'edited'; // client lies about an untouched bullet
    const entry = next.sections.flatMap((s) => s.entries)[1]!;
    entry.bullets.push({
      id: 'novo-1',
      text: 'Novo item',
      sourceIds: entry.sourceIds,
      origin: 'generated',
    });
    const out = reconcileOrigins(previous, next);
    const flat = out.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets));
    expect(flat[0]?.origin).toBe('edited');
    expect(flat[1]?.origin).toBe('generated');
    expect(flat.find((b) => b.id === 'novo-1')?.origin).toBe('added');
  });
});
