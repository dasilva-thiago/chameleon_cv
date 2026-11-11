import { resumeContentSchema, type ResumeContent } from '@chameleon/contracts';
import { describe, expect, it } from 'vitest';
import {
  avoidedExpressions,
  buildBaseResume,
  buildResume,
  containsQuote,
  containsTerm,
  fold,
  hashProfileBase,
  keywordCoverage,
  parseBaseCv,
  reconcileOrigins,
  recommendationFor,
  resumeLanguage,
  validateResume,
} from '../src';

const CV = [
  '<!-- comentário que não aparece -->',
  '# CV -- Ana Teste',
  '**Headline:** Desenvolvedora de Software',
  '**Location:** Curitiba - PR',
  '**Phone:** (41) 99999-0000',
  '**Email:** ana@example.test',
  '**LinkedIn:** https://www.linkedin.com/in/ana-teste/',
  '',
  '## Professional Summary',
  '',
  'Estudante com experiência em suporte e um projeto full stack.',
  '',
  '## Work Experience',
  '',
  '### Prefeitura de Curitiba — Curitiba - PR · Programa Digital',
  '',
  '**Suporte Técnico**',
  '2026 - Atual',
  '',
  '- Controle de 192 equipamentos.',
  '- Atendimento a usuários.',
  '',
  '### Acme — São Paulo - SP',
  '',
  '**Jovem Aprendiz -> Assistente de Laboratório**',
  '2023 - 2025',
  '',
  '- Registro de dados de ensaios.',
  '',
  '## Projects',
  '',
  '### Painel de Equipamentos',
  '',
  'https://painel.example.test',
  '',
  'TypeScript, Node.js, PostgreSQL',
  '',
  '- APIs REST com Node.js.',
  '',
  '## Education',
  '',
  '### UFPR — São Paulo',
  '',
  '**Engenharia da Computação**',
  'Em andamento',
  'Base acadêmica: Banco de Dados.',
  '',
  '## Skills',
  '',
  '- **Linguagens:** TypeScript, Python, C#',
  '- **Backend:** Node.js, Express',
  '',
  '## Languages',
  '',
  '- Inglês: Avançado',
  '',
].join('\n');

const clone = (content: ResumeContent): ResumeContent =>
  JSON.parse(JSON.stringify(content)) as ResumeContent;

const PROFILE =
  '## Expressões a evitar\n- "ampla experiência"\n- ninja\n\n**Idioma do currículo:** pt-BR\n';

describe('text helpers', () => {
  it('fold ignores case, accents, markdown emphasis and line breaks', () => {
    expect(fold('**Engenharia**  da\nComputação')).toBe('engenharia da computacao');
  });
  it('containsTerm matches whole words only', () => {
    const hay = fold('Uso de Java Script e C# no projeto');
    expect(containsTerm(hay, 'C#')).toBe(true);
    expect(containsTerm(fold('Experiência com JavaScript'), 'Java')).toBe(false);
  });
  it('containsQuote accepts ellipsis-joined fragments, all of which must exist', () => {
    const hay = fold('Controle de 192 equipamentos. Atendimento a usuários.');
    expect(containsQuote(hay, 'Controle de 192 … Atendimento a usuários')).toBe(true);
    expect(containsQuote(hay, 'Controle de 200 equipamentos')).toBe(false);
  });
  it('the base hash changes with either text and only with them', () => {
    expect(hashProfileBase('a', 'b')).toBe(hashProfileBase('a', 'b'));
    expect(hashProfileBase('a', 'b')).not.toBe(hashProfileBase('a', 'c'));
  });
});

describe('parseBaseCv', () => {
  const base = parseBaseCv(CV);
  it('reads the header and contacts', () => {
    expect(base).toMatchObject({
      name: 'Ana Teste',
      headline: 'Desenvolvedora de Software',
      location: 'Curitiba - PR',
    });
    expect(base.contacts.map((c) => c.kind)).toEqual(['phone', 'email', 'link']);
  });
  it('reads experiences with exact titles, places, descriptors and order', () => {
    expect(
      base.experiences.map((e) => [e.company, e.location, e.descriptor, e.title, e.period]),
    ).toEqual([
      [
        'Prefeitura de Curitiba',
        'Curitiba - PR',
        'Programa Digital',
        'Suporte Técnico',
        '2026 - Atual',
      ],
      [
        'Acme',
        'São Paulo - SP',
        null,
        'Jovem Aprendiz -> Assistente de Laboratório',
        '2023 - 2025',
      ],
    ]);
    expect(base.experiences[0]?.bullets).toHaveLength(2);
  });
  it('reads projects, education, skills and languages', () => {
    expect(base.projects[0]).toMatchObject({
      name: 'Painel de Equipamentos',
      url: 'https://painel.example.test',
      tech: 'TypeScript, Node.js, PostgreSQL',
    });
    expect(base.education[0]).toMatchObject({
      institution: 'UFPR',
      course: 'Engenharia da Computação',
      period: 'Em andamento',
      details: ['Base acadêmica: Banco de Dados.'],
    });
    expect(base.skills).toEqual([
      { group: 'Linguagens', items: ['TypeScript', 'Python', 'C#'] },
      { group: 'Backend', items: ['Node.js', 'Express'] },
    ]);
    expect(base.languages).toEqual(['Inglês: Avançado']);
  });
  it('never throws on free text', () => {
    expect(() => parseBaseCv('qualquer coisa\n### sem seção\n- item')).not.toThrow();
  });
});

describe('profile rules', () => {
  it('reads the avoided expressions and the resume language', () => {
    expect(avoidedExpressions(PROFILE)).toEqual(['ampla experiência', 'ninja']);
    expect(resumeLanguage(PROFILE)).toBe('pt-BR');
    expect(resumeLanguage('')).toBe('pt-BR');
    expect(resumeLanguage('**Resume language:** en')).toBe('en');
  });
});

describe('buildResume', () => {
  const base = parseBaseCv(CV);
  it('the base resume is valid and has no fact-check issue', () => {
    const content = buildBaseResume(base, 'pt-BR');
    expect(() => resumeContentSchema.parse(content)).not.toThrow();
    expect(validateResume(content, { cvMarkdown: CV, profileMarkdown: PROFILE })).toEqual([]);
  });
  it('a plan never changes titles, dates or the order of the experiences; unknown items are dropped', () => {
    const { content, notes } = buildResume(base, 'pt-BR', {
      headline: 'Dev Backend Júnior',
      summary: 'Resumo adaptado.',
      competencies: ['Node.js', 'Node.js', 'APIs REST'],
      experience: [
        { company: 'acme', bullets: ['Registro de dados de ensaios.'] },
        { company: 'Empresa Fantasma', bullets: ['x'] },
      ],
      projects: [{ name: 'painel de equipamentos', bullets: [] }],
      skills: [],
    });
    const exp = content.sections.find((s) => s.kind === 'experience')!;
    expect(exp.entries.map((e) => [e.heading, e.period])).toEqual([
      ['Suporte Técnico', '2026 - Atual'],
      ['Jovem Aprendiz -> Assistente de Laboratório', '2023 - 2025'],
    ]);
    expect(exp.entries[1]?.bullets.map((b) => b.text)).toEqual(['Registro de dados de ensaios.']);
    expect(notes.join(' ')).toContain('Empresa Fantasma');
    const comp = content.sections.find((s) => s.kind === 'competencies')!;
    expect(comp.entries[0]?.bullets.map((b) => b.text)).toEqual(['Node.js', 'APIs REST']);
    const proj = content.sections.find((s) => s.kind === 'projects')!;
    expect(proj.entries[0]).toMatchObject({
      heading: 'Painel de Equipamentos',
      url: 'https://painel.example.test',
    });
    expect(content.header.headline).toBe('Dev Backend Júnior');
  });
});

describe('validateResume (career-ops fact checks)', () => {
  const sources = { cvMarkdown: CV, profileMarkdown: PROFILE, keywords: ['Kubernetes', 'Node.js'] };
  const tamper = (change: (content: ResumeContent) => void): ResumeContent => {
    const content = clone(buildBaseResume(parseBaseCv(CV), 'pt-BR'));
    change(content);
    return content;
  };
  const codes = (content: ResumeContent) =>
    validateResume(content, sources).map((i) => `${i.severity}:${i.code}`);
  const firstBullet = (content: ResumeContent) =>
    content.sections.find((s) => s.kind === 'experience')!.entries[0]!.bullets[0]!;

  it('a number that is not in the base is an error; one that is passes', () => {
    expect(codes(tamper((c) => (firstBullet(c).text = 'Controle de 250 equipamentos.')))).toContain(
      'error:UNSUPPORTED_NUMBER',
    );
    expect(
      codes(
        tamper((c) => (firstBullet(c).text = 'Controle de 192 equipamentos com 2026 de dados.')),
      ),
    ).not.toContain('error:UNSUPPORTED_NUMBER');
  });
  it('a changed job title is an error', () => {
    const content = tamper(
      (c) =>
        (c.sections.find((s) => s.kind === 'experience')!.entries[0]!.heading =
          'Analista de Suporte Pleno'),
    );
    expect(codes(content)).toEqual(
      expect.arrayContaining(['error:TITLE_MISMATCH', 'error:SENIORITY_CLAIM']),
    );
  });
  it('seniority words and avoided expressions are errors', () => {
    expect(codes(tamper((c) => (c.header.headline = 'Desenvolvedora Sênior')))).toContain(
      'error:SENIORITY_CLAIM',
    );
    expect(
      codes(
        tamper((c) => (firstBullet(c).text = 'Profissional com ampla experiência em suporte.')),
      ),
    ).toContain('error:FORBIDDEN_PHRASE');
  });
  it('a tool or job keyword the base never mentions is a warning', () => {
    const content = tamper((c) => (firstBullet(c).text = 'Deploy com Kubernetes e AWS.'));
    const found = validateResume(content, sources);
    expect(
      found
        .filter((i) => i.code === 'UNSUPPORTED_TERM')
        .map((i) => i.message)
        .join(' '),
    ).toMatch(/Kubernetes|AWS/);
    expect(found.every((i) => i.code !== 'UNSUPPORTED_TERM' || i.severity === 'warning')).toBe(
      true,
    );
  });
  it('experiences out of the base order and unknown companies are warnings', () => {
    const swapped = tamper((c) =>
      c.sections.find((s) => s.kind === 'experience')!.entries.reverse(),
    );
    expect(codes(swapped)).toContain('warning:EXPERIENCE_ORDER');
    const unknown = tamper(
      (c) =>
        (c.sections.find((s) => s.kind === 'experience')!.entries[0]!.subheading = 'Outra Empresa'),
    );
    expect(codes(unknown)).toContain('warning:UNKNOWN_EXPERIENCE');
  });
  it('keyword coverage counts the job keywords present in the resume', () => {
    const content = buildBaseResume(parseBaseCv(CV), 'pt-BR');
    expect(keywordCoverage(content, ['Node.js', 'node.js', 'Kubernetes', 'PostgreSQL'])).toEqual({
      percent: 67,
      present: ['node.js', 'PostgreSQL'],
      missing: ['Kubernetes'],
    });
    expect(keywordCoverage(content, [])).toBeNull();
  });
  it('edited text loses the generated origin', () => {
    const before = buildBaseResume(parseBaseCv(CV), 'pt-BR');
    const after = clone(before);
    firstBullet(after).text = 'Outro texto';
    expect(firstBullet(reconcileOrigins(before, after)).origin).toBe('edited');
  });
});

describe('recommendation (career-ops thresholds)', () => {
  it('4.0+ apply, 3.5-3.9 consider, below skip; any dealbreaker skips', () => {
    expect(recommendationFor(4, 0)).toBe('apply');
    expect(recommendationFor(3.9, 0)).toBe('consider');
    expect(recommendationFor(3.4, 0)).toBe('skip');
    expect(recommendationFor(4.8, 1)).toBe('skip');
  });
});
