import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EDGE_PROFILES,
  EDGE_PROFILES_DIR,
  FIXTURES_ROOT,
  JOB_IDS,
  JOBS_DIR,
  PROFILES,
  PROFILES_DIR,
  listEdgeProfiles,
  edgeProfileFile,
  listFilesOnDisk,
  listJobs,
  listProfileIds,
  listProfiles,
  listScenarios,
  loadEdgeProfileYaml,
  loadJob,
  loadJobMeta,
  loadJobText,
  loadProfile,
  loadProfileYaml,
  parseProfileYaml,
  type EdgeProfileId,
  type JobId,
  type ProfileId,
} from '../src/index';
import { isRec } from './support';

describe('catalogo x arquivos em disco', () => {
  it('cada perfil do catalogo tem um .yaml e nao ha .yaml orfao em profiles/', () => {
    const onDisk = listFilesOnDisk(PROFILES_DIR);
    expect(onDisk).toEqual(PROFILES.map((p) => `${p.id}.yaml`).sort());
  });

  it('cada caso de borda tem um .yaml e nao ha arquivo orfao em profiles-edge/', () => {
    const onDisk = listFilesOnDisk(EDGE_PROFILES_DIR);
    const expected = EDGE_PROFILES.map((p) => edgeProfileFile(p.id)).sort();
    expect(onDisk).toEqual(expected);
  });

  it('cada vaga tem .txt e .meta.json e nao ha arquivo orfao em jobs/', () => {
    const expected = JOB_IDS.flatMap((id) => [`${id}.meta.json`, `${id}.txt`]).sort();
    expect(listFilesOnDisk(JOBS_DIR)).toEqual(expected);
  });

  it('as 13 fixtures de perfil e as 10 vagas do plano §5.1 existem', () => {
    const requiredProfiles = [
      'student-no-employment',
      'experienced-promotions-same-employer',
      'career-changer-teacher-to-data',
      'non-tech-nurse',
      'non-tech-logistics',
      'freelancer-confidential-clients',
      'no-links-no-portfolio',
      'imprecise-dates',
      'conflicting-facts',
      'private-heavy',
      'international-en-US',
      'minimal-partial',
      'legacy-1.0.0-filled',
    ];
    const requiredJobs = [
      'backend-java',
      'k8s-gap',
      'five-years-backend',
      'injection',
      'english-posting',
      'nurse-icu',
      'sales-b2b',
      'logistics-coordinator',
      'malformed-long',
      'very-short',
    ];
    expect(listProfileIds()).toEqual(expect.arrayContaining(requiredProfiles as ProfileId[]));
    expect(listJobs()).toEqual(expect.arrayContaining(requiredJobs as JobId[]));
    expect(listProfiles()).toHaveLength(requiredProfiles.length);
  });

  it('o README documenta todas as fixtures e todos os cenarios (anti-deriva)', () => {
    const readme = readFileSync(join(FIXTURES_ROOT, 'README.md'), 'utf8');
    const missing = [
      ...PROFILES.map((p) => p.id),
      ...EDGE_PROFILES.map((p) => p.id),
      ...JOB_IDS,
      ...listScenarios().map((s) => s.id),
    ].filter((id) => !readme.includes(id));
    expect(missing).toEqual([]);
  });
});

describe('perfis: YAML parseia e tem o formato esperado', () => {
  it.each(PROFILES.map((p) => [p.id, p] as const))('%s parseia como YAML', (id, info) => {
    const doc = loadProfile(id);
    expect(doc.schema_version).toBe(info.schemaVersion);
    expect(doc.locale).toBe(info.locale);
    expect(isRec(doc.profile)).toBe(true);
  });

  it.each(PROFILES.map((p) => p.id))('%s: texto nao vazio, LF e termina com newline', (id) => {
    const text = loadProfileYaml(id);
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toContain('\r');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('o formato v2 usa snake_case e nenhuma chave camelCase', () => {
    for (const info of PROFILES.filter((p) => p.format === 'v2')) {
      const bad: string[] = [];
      const visit = (node: unknown, path: string): void => {
        if (Array.isArray(node)) node.forEach((n, i) => visit(n, `${path}[${i}]`));
        else if (isRec(node)) {
          for (const [k, v] of Object.entries(node)) {
            // chaves de field_states podem ter ponto (ex.: business.portfolio_url)
            if (!/^[a-z0-9_.-]+$/.test(k) && path.includes('field_states') === false) {
              bad.push(`${path}.${k}`);
            }
            visit(v, `${path}.${k}`);
          }
        }
      };
      visit(parseProfileYaml(loadProfileYaml(info.id)), info.id);
      expect(bad, `${info.id}: chaves fora de snake_case`).toEqual([]);
    }
  });
});

describe('casos de borda', () => {
  it.each(listEdgeProfiles().map((e) => [e.id, e.expected] as const))(
    '%s (%s): sintaxe YAML conforme o esperado',
    (id, expected) => {
      const text = loadEdgeProfileYaml(id as EdgeProfileId);
      if (expected === 'yaml_syntax_error') {
        expect(() => parseProfileYaml(text)).toThrow();
      } else {
        expect(() => parseProfileYaml(text)).not.toThrow();
      }
    },
  );

  it('so broken-syntax tem erro de sintaxe; os demais parseiam', () => {
    const syntaxErrors = EDGE_PROFILES.filter((e) => e.expected === 'yaml_syntax_error');
    expect(syntaxErrors.map((e) => e.id)).toEqual(['broken-syntax']);
  });

  it('cada caso de borda explica o resultado esperado', () => {
    for (const edge of EDGE_PROFILES) expect(edge.reason.length).toBeGreaterThan(20);
  });

  it('o resultado esperado cobre aceito, aceito com avisos, rejeitado e erro de sintaxe', () => {
    const kinds = new Set(EDGE_PROFILES.map((e) => e.expected));
    expect([...kinds].sort()).toEqual(
      ['accepted', 'accepted_with_warnings', 'rejected', 'yaml_syntax_error'].sort(),
    );
  });
});

describe('vagas', () => {
  it.each(JOB_IDS.map((id) => [id] as const))('%s: meta e texto coerentes', (id) => {
    const meta = loadJobMeta(id);
    const text = loadJobText(id);
    expect(meta.id).toBe(id);
    expect(meta.title.length).toBeGreaterThan(3);
    expect(['pt-BR', 'en-US']).toContain(meta.locale);
    expect(meta.description.length).toBeGreaterThan(30);
    expect(meta.scenario_ids.length).toBeGreaterThan(0);
    expect(meta.target_profiles.length).toBeGreaterThan(0);
    expect(text.trim().length).toBeGreaterThan(20);
    expect(loadJob(id).text).toBe(text);
  });

  it.each(JOB_IDS.map((id) => [id] as const))(
    '%s: cada excerpt esperado esta contido literalmente no texto da vaga (P§21.4)',
    (id) => {
      const { meta, text } = loadJob(id);
      const e = meta.expectations;
      const excerpts = [
        ...e.mandatory.map((r) => r.excerpt),
        ...e.desirable.map((r) => r.excerpt),
        ...e.responsibilities.map((r) => r.excerpt),
        ...e.years_required.map((y) => y.excerpt),
      ];
      const missing = excerpts.filter((x) => !text.includes(x));
      expect(missing).toEqual([]);
    },
  );

  it.each(JOB_IDS.map((id) => [id] as const))(
    '%s: campos ausentes na vaga sao null e presentes aparecem no texto',
    (id) => {
      const { meta, text } = loadJob(id);
      const { company, salary, location } = meta.expectations;
      for (const value of [company, salary, location]) {
        if (value !== null) expect(text).toContain(value);
      }
      if (meta.expectations.work_mode === null) {
        expect(text).not.toMatch(/remoto|h[ií]brido|presencial/i);
      }
    },
  );

  it('as vagas com campos ausentes cobrem null para empresa, salario e modalidade', () => {
    const metas = JOB_IDS.map((id) => loadJobMeta(id));
    expect(metas.some((m) => m.expectations.company === null)).toBe(true);
    expect(metas.some((m) => m.expectations.salary === null)).toBe(true);
    expect(metas.some((m) => m.expectations.work_mode === null)).toBe(true);
  });

  it('cada perfil alvo existe e cada cenario citado existe e lista a vaga', () => {
    const profileIds = new Set<string>(listProfileIds());
    const scenarios = new Map(listScenarios().map((s) => [s.id, s]));
    for (const id of JOB_IDS) {
      const meta = loadJobMeta(id);
      for (const target of meta.target_profiles) expect(profileIds.has(target)).toBe(true);
      for (const scenarioId of meta.scenario_ids) {
        const scenario = scenarios.get(scenarioId);
        expect(scenario, `${id}: cenario ${scenarioId}`).toBeDefined();
        expect((scenario?.jobs as readonly string[] | undefined) ?? []).toContain(id);
      }
    }
  });

  it('malformed-long e longa (>= 20 mil caracteres) e very-short e curta (< 200)', () => {
    expect(loadJobText('malformed-long').length).toBeGreaterThanOrEqual(20_000);
    expect(loadJobText('very-short').length).toBeLessThan(200);
  });

  it('injection contem a instrucao maliciosa e o canario de payload', () => {
    const { meta, text } = loadJob('injection');
    expect(text).toMatch(/ignore as instruções anteriores/i);
    expect(text).toContain('CANARY-injection-payload');
    expect(meta.forbidden_output_markers).toContain('CANARY-injection-payload');
  });

  it('a vaga em ingles esta em en-US e o texto esta em ingles', () => {
    const { meta, text } = loadJob('english-posting');
    expect(meta.locale).toBe('en-US');
    expect(text).toMatch(/Requirements/);
    expect(text).not.toMatch(/Requisitos/);
  });

  it('a tabela de requisitos esperados distingue obrigatorio, desejavel e responsabilidade', () => {
    const e = loadJobMeta('backend-java').expectations;
    expect(e.mandatory.length).toBeGreaterThan(0);
    expect(e.desirable.length).toBeGreaterThan(0);
    expect(e.responsibilities.length).toBeGreaterThan(0);
    expect(e.years_required[0]?.professional_only).toBe(true);
  });
});

describe('carregadores', () => {
  it('lancam erro claro para id desconhecido', () => {
    expect(() => loadProfileYaml('nao-existe' as ProfileId)).toThrow(/desconhecida/);
    expect(() => loadJobText('nao-existe' as JobId)).toThrow(/desconhecida/);
    expect(() => loadEdgeProfileYaml('nao-existe' as EdgeProfileId)).toThrow(/desconhecida/);
  });

  it('parseProfileYaml rejeita raiz que nao e objeto', () => {
    expect(() => parseProfileYaml('- a\n- b\n')).toThrow(/objeto/);
    expect(() => parseProfileYaml('texto')).toThrow(/objeto/);
  });
});
