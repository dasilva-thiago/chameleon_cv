import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADENDO_11_SCENARIOS,
  EDGE_PROFILES,
  JOB_IDS,
  NEGATIVE_SCENARIOS,
  PROFILES,
  listScenarios,
  edgeProfilePath,
  getScenario,
  jobMetaPath,
  jobTextPath,
  listProfileCanaries,
  loadJob,
  profilePath,
  scenariosForJob,
  scenariosForProfile,
  type EdgeProfileId,
  type JobId,
  type ProfileId,
  type ScenarioDef,
  type ScenarioId,
} from '../src/index';
import {
  fieldStatesOf,
  isRec,
  listOf,
  metaOf,
  profileOf,
  skillName,
  str,
  usageContexts,
  usagesOf,
  walk,
  type Rec,
} from './support';

/** Tipado como ScenarioDef[] (o literal `as const` perde propriedades opcionais entre elementos). */
const SCENARIOS: readonly ScenarioDef[] = listScenarios();

describe('cenarios: Adendo §11 e Plano §20', () => {
  it('o Adendo §11 tem os 15 itens numerados, cada um uma vez, mais a frase final', () => {
    const numbered = ADENDO_11_SCENARIOS.map((s) => /item (\d+)$/.exec(s.ref)?.[1]).filter(
      (n): n is string => n !== undefined,
    );
    expect(numbered.map(Number).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    const finalSentence = ADENDO_11_SCENARIOS.filter((s) => s.ref.includes('parágrafo final'));
    expect(finalSentence).toHaveLength(1);
    expect(ADENDO_11_SCENARIOS).toHaveLength(16);
  });

  it('os casos negativos do Plano §20 sao 8, numerados de 1 a 8', () => {
    const numbered = NEGATIVE_SCENARIOS.map((s) => Number(/item (\d+)$/.exec(s.ref)?.[1]));
    expect(numbered.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('ids de cenario sao unicos e todos tem descricao e expectativa', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.title.length, s.id).toBeGreaterThan(5);
      expect(s.description.length, s.id).toBeGreaterThan(20);
      expect(s.expect.length, s.id).toBeGreaterThan(20);
    }
  });

  it.each(SCENARIOS.filter((s) => s.group !== 'extra').map((s) => [s.id, s] as const))(
    '%s: tem >= 1 fixture de perfil existente em disco',
    (_id, scenario) => {
      expect(scenario.profiles.length).toBeGreaterThanOrEqual(1);
      for (const profile of scenario.profiles) {
        expect(existsSync(profilePath(profile)), `${scenario.id} -> ${profile}`).toBe(true);
      }
    },
  );

  it.each(NEGATIVE_SCENARIOS.map((s) => [s.id, s] as const))(
    '%s: caso negativo tem >= 1 vaga existente em disco',
    (_id, scenario) => {
      expect(scenario.jobs.length).toBeGreaterThanOrEqual(1);
      for (const job of scenario.jobs) {
        expect(existsSync(jobTextPath(job)), `${scenario.id} -> ${job}`).toBe(true);
        expect(existsSync(jobMetaPath(job))).toBe(true);
      }
    },
  );

  it('toda referencia de cenario (perfil, borda, vaga) aponta para arquivo existente', () => {
    for (const s of SCENARIOS) {
      for (const p of s.profiles) expect(existsSync(profilePath(p)), `${s.id}:${p}`).toBe(true);
      for (const e of s.edgeProfiles ?? []) {
        expect(existsSync(edgeProfilePath(e)), `${s.id}:${e}`).toBe(true);
      }
      for (const j of s.jobs) expect(existsSync(jobTextPath(j)), `${s.id}:${j}`).toBe(true);
    }
  });

  it('nenhuma fixture fica sem cenario (perfil, borda e vaga)', () => {
    const orphanProfiles = PROFILES.filter((p) => scenariosForProfile(p.id).length === 0);
    expect(orphanProfiles.map((p) => p.id)).toEqual([]);
    const usedEdges = new Set(SCENARIOS.flatMap((s) => s.edgeProfiles ?? []));
    expect(EDGE_PROFILES.filter((e) => !usedEdges.has(e.id)).map((e) => e.id)).toEqual([]);
    expect(JOB_IDS.filter((j) => scenariosForJob(j).length === 0)).toEqual([]);
  });

  it('getScenario devolve o cenario e falha para id desconhecido', () => {
    expect(getScenario('neg-java-vs-javascript').jobs).toContain('backend-java');
    expect(() => getScenario('nao-existe' as ScenarioId)).toThrow(/desconhecido/);
  });
});

// ---------------------------------------------------------------------------------------------
// Evidencia estrutural: o cenario declarado realmente esta presente nos dados da fixture.
// Cada verificacao devolve a lista de problemas (vazia = ok) para os perfis listados no cenario.
// ---------------------------------------------------------------------------------------------

type Check = (profile: Rec, id: ProfileId) => string[];

const DATE_YEAR = /^\d{4}$/;
const DATE_MONTH = /^\d{4}-\d{2}$/;
const DATE_DAY = /^\d{4}-\d{2}-\d{2}$/;

function experiences(profile: Rec): Rec[] {
  return listOf(profile, 'experiences');
}

function allRecordsWithMeta(profile: Rec): Rec[] {
  const out: Rec[] = [];
  walk(profile, ({ value }) => {
    if (isRec(value) && typeof value.id === 'string' && isRec(value.meta)) out.push(value);
  });
  return out;
}

const teamProjectWithBoundedContribution: Check = (p, id) => {
  const ok = listOf(p, 'projects').some(
    (prj) =>
      prj.team_based === true &&
      typeof prj.personal_contribution === 'string' &&
      typeof prj.contributions_by_others === 'string',
  );
  return ok
    ? []
    : [`${id}: sem projeto em equipe com personal_contribution e contributions_by_others`];
};

const structural: Partial<Record<ScenarioId, Check>> = {
  'a11-01-student-no-employment': (p, id) => {
    const problems: string[] = [];
    if (experiences(p).length !== 0) problems.push(`${id}: experiences deveria ser []`);
    if (!Array.isArray(p.experiences)) problems.push(`${id}: experiences deveria ser [] explícito`);
    if (listOf(p, 'education').length === 0) problems.push(`${id}: sem formação`);
    if (listOf(p, 'projects').length === 0) problems.push(`${id}: sem projetos`);
    if (usageContexts(p).has('professional_experience')) {
      problems.push(`${id}: nao pode ter professional_experience`);
    }
    return problems;
  },
  'a11-02-experienced-many-roles-promotions': (p, id) =>
    experiences(p).length >= 4 ? [] : [`${id}: menos de 4 experiencias`],
  'a11-03-freelancer-confidential-clients': (p, id) => {
    const ok = experiences(p).some((e) => {
      const business = isRec(e.business) ? e.business : {};
      return (
        ['freelance', 'self_employed'].includes(str(e.employment_type) ?? '') &&
        Object.keys(business).length > 0 &&
        // contrato 2.0.0: a divulgacao de clientes nao e campo; vira nome publico generico + restricoes
        typeof e.organization_public_name === 'string'
      );
    });
    const never = listOf(isRec(p.usage_rules) ? p.usage_rules : {}, 'restrictions').filter(
      (r) => r.rule === 'never_include',
    );
    return [
      ...(ok ? [] : [`${id}: sem experiencia autonoma com business e organization_public_name`]),
      ...(never.length >= 1 ? [] : [`${id}: sem restricao never_include para nomes de clientes`]),
    ];
  },
  'a11-04-career-transition': (p, id) => {
    const c = usageContexts(p);
    return c.has('professional_experience') && c.has('coursework') && c.has('project_experience')
      ? []
      : [`${id}: precisa de professional_experience, coursework e project_experience`];
  },
  'a11-05-transferable-skills-few-keywords': (p, id) => {
    const transferable = usagesOf(p).filter(
      (u) =>
        u.usage_context === 'professional_experience' &&
        ['Excel', 'Estatística descritiva'].includes(skillName(p, u.skill_id) ?? ''),
    );
    return transferable.length >= 1 ? [] : [`${id}: sem competencia transferivel profissional`];
  },
  'a11-06-no-portfolio-or-links': (p, id) => {
    const problems: string[] = [];
    if (listOf(p, 'contact_points').some((c) => c.kind === 'link'))
      problems.push(`${id}: tem link`);
    if (listOf(p, 'evidence').some((e) => /^https?:/.test(str(e.url_or_location) ?? ''))) {
      problems.push(`${id}: evidencia com URL`);
    }
    if (
      listOf(p, 'projects').some(
        (pr) => typeof pr.public_url === 'string' || typeof pr.repository_url === 'string',
      )
    ) {
      problems.push(`${id}: projeto com URL`);
    }
    return problems;
  },
  'a11-07-multiple-roles-same-employer': (p, id) => {
    const byOrg = new Map<string, number>();
    for (const e of experiences(p)) {
      const org = str(e.organization_name);
      if (org) byOrg.set(org, (byOrg.get(org) ?? 0) + 1);
    }
    return [...byOrg.values()].some((n) => n >= 2) ? [] : [`${id}: nenhum empregador repetido`];
  },
  'a11-08-team-project-bounded-contribution': teamProjectWithBoundedContribution,
  'a11-09-imprecise-dates': (p, id) => {
    const dates: unknown[] = [];
    walk(p, ({ value, path }) => {
      const key = path[path.length - 1];
      if (['start_date', 'end_date', 'issue_date', 'completion_date', 'date'].includes(String(key)))
        dates.push(value);
    });
    const strs = dates.filter((d): d is string => typeof d === 'string');
    const exps = experiences(p);
    const problems: string[] = [];
    if (!strs.some((d) => DATE_YEAR.test(d))) problems.push(`${id}: sem data so com ano`);
    if (!strs.some((d) => DATE_MONTH.test(d))) problems.push(`${id}: sem data ano-mes`);
    if (!strs.some((d) => DATE_DAY.test(d))) problems.push(`${id}: sem data ano-mes-dia`);
    if (!exps.some((e) => e.start_date === null)) problems.push(`${id}: sem inicio null`);
    if (!exps.some((e) => e.end_date === null)) problems.push(`${id}: sem fim null`);
    if (!exps.some((e) => e.end_date === 'present')) problems.push(`${id}: sem fim present`);
    return problems;
  },
  'a11-10-conflicting-facts': (p, id) => {
    const conflicting = allRecordsWithMeta(p).filter((r) => metaOf(r).status === 'conflicting');
    const pending = listOf(p, 'pending_items');
    const problems: string[] = [];
    if (conflicting.length === 0) problems.push(`${id}: sem registro conflicting`);
    for (const record of conflicting) {
      const match = pending.find((pi) => {
        const target = isRec(pi.target) ? pi.target : {};
        return (
          target.record_id === record.id ||
          (typeof target.record_id === 'string' &&
            String(target.record_id).startsWith(`${String(record.id)}-`))
        );
      });
      if (!match) problems.push(`${id}: ${String(record.id)} conflicting sem pendencia`);
      else if (!str(match.safe_statement_for_now)) {
        problems.push(`${id}: pendencia de ${String(record.id)} sem safe_statement_for_now`);
      }
    }
    return problems;
  },
  'a11-11-studying-vs-professional-tech': (p, id) => {
    const c = usageContexts(p);
    const learning = ['coursework', 'self_declared_knowledge', 'conceptual_familiarity'];
    return learning.some((x) => c.has(x)) ? [] : [`${id}: sem contexto de estudo`];
  },
  'a11-12-languages-per-skill': (p, id) => {
    const ok = listOf(p, 'languages').some((l) => {
      const levels = ['reading', 'writing', 'listening', 'speaking'].map((k) => l[k]);
      return new Set(levels).size > 1;
    });
    return ok ? [] : [`${id}: nenhum idioma com niveis diferentes por habilidade`];
  },
  'a11-13-private-data-not-in-document': (_p, id) =>
    listProfileCanaries(id).length >= 1 ? [] : [`${id}: sem canarios`],
  'a11-14-unknown-empty-not-applicable': (p, id) => {
    const hasNullOrEmpty =
      walkHas(p, (v) => v === null) || walkHas(p, (v) => Array.isArray(v) && v.length === 0);
    return hasNullOrEmpty ? [] : [`${id}: sem null nem [] explicitos`];
  },
};

function walkHas(root: unknown, predicate: (v: unknown) => boolean): boolean {
  let found = false;
  walk(root, ({ value }) => {
    if (predicate(value)) found = true;
  });
  return found;
}

describe('cenarios: evidencia estrutural nos dados das fixtures', () => {
  for (const [scenarioId, check] of Object.entries(structural) as [ScenarioId, Check][]) {
    it(`${scenarioId}: cada perfil listado exibe o cenario`, () => {
      const scenario = getScenario(scenarioId);
      const problems = scenario.profiles.flatMap((id) => check(profileOf(id), id));
      expect(problems).toEqual([]);
    });
  }

  it('a11-14: os cinco estados de campo aparecem (uniao entre os perfis do cenario)', () => {
    const scenario = getScenario('a11-14-unknown-empty-not-applicable');
    const states = new Set<string>();
    for (const id of scenario.profiles) for (const s of fieldStatesOf(profileOf(id))) states.add(s);
    // not_provided e o estado implicito de null/omitido; os explicitos aparecem em field_states.
    expect([...states].sort()).toEqual(
      ['declined', 'needs_confirmation', 'not_applicable', 'not_assessed', 'not_provided'].sort(),
    );
  });

  it('a11-15: o legado 1.0.0 tem "" e registro fantasma (para EMPTY_STRING_NORMALIZED/EMPTY_RECORD_DROPPED)', () => {
    const doc = profileOf('legacy-1.0.0-filled');
    expect(walkHas(doc, (v) => v === '')).toBe(true);
    const awards = listOf(doc, 'awards');
    expect(
      awards.some((a) => ['name', 'organization', 'date'].every((k) => a[k] === '')),
      'registro fantasma em awards',
    ).toBe(true);
    const contexts = new Set<string>();
    walk(doc, ({ value, path }) => {
      if (path[path.length - 1] === 'usage_context' && typeof value === 'string')
        contexts.add(value);
    });
    expect([...contexts].sort()).toEqual(
      ['internal_project', 'other', 'professional', 'study', 'training'].sort(),
    );
    const statuses = new Set<string>();
    walk(doc, ({ value, path }) => {
      if (path[path.length - 1] === 'fact_status' && typeof value === 'string') statuses.add(value);
    });
    expect([...statuses].sort()).toEqual(['confirmed', 'conflicting', 'needs_review'].sort());
    const skills = listOf(doc, 'skills');
    expect(
      skills.some(
        (s) =>
          Array.isArray(s.acquisition_contexts) &&
          s.acquisition_contexts.includes('employment') &&
          Array.isArray(s.related_experience_ids) &&
          s.related_experience_ids.length === 0,
      ),
      'skill com employment sem experiencia relacionada',
    ).toBe(true);
    expect(isRec(doc.review) && doc.review.processing_consent).toBe('granted');
  });

  it('same-profile-different-jobs: >= 2 perfis e >= 4 vagas distintas', () => {
    const s = getScenario('same-profile-different-jobs');
    expect(s.profiles.length).toBeGreaterThanOrEqual(2);
    expect(new Set(s.jobs).size).toBeGreaterThanOrEqual(4);
  });

  it('a mesma persona tem mais de uma vaga alvo (comparar curriculos)', () => {
    const jobsPerProfile = new Map<string, Set<string>>();
    for (const id of JOB_IDS) {
      for (const target of loadJob(id).meta.target_profiles) {
        jobsPerProfile.set(target, (jobsPerProfile.get(target) ?? new Set()).add(id));
      }
    }
    const multi = [...jobsPerProfile.values()].filter((jobs) => jobs.size >= 2);
    expect(multi.length).toBeGreaterThanOrEqual(2);
  });
});

describe('casos negativos: as fixtures de fato provocam o caso', () => {
  it('neg-java-vs-javascript: perfil tem JavaScript e nenhum "Java"; vaga exige Java', () => {
    const p = profileOf('student-no-employment');
    const names = listOf(p, 'skills').map((s) => str(s.name));
    expect(names).toContain('JavaScript');
    expect(names).not.toContain('Java');
    const { meta } = loadJob('backend-java');
    expect(meta.expectations.mandatory.some((r) => /\bJava\b/.test(r.text))).toBe(true);
  });

  it('neg-kubernetes-gap: nenhum perfil listado usa Kubernetes como experiencia profissional', () => {
    const scenario = getScenario('neg-kubernetes-gap');
    for (const id of scenario.profiles) {
      const p = profileOf(id);
      const professional = usagesOf(p).filter(
        (u) =>
          u.usage_context === 'professional_experience' &&
          skillName(p, u.skill_id) === 'Kubernetes',
      );
      expect(professional, id).toEqual([]);
    }
    // e a vaga exige Kubernetes em producao
    expect(loadJob('k8s-gap').meta.expectations.mandatory[0]?.text).toMatch(/Kubernetes/);
    // o perfil experiente tem Kubernetes apenas como estudo declarado
    const experienced = profileOf('experienced-promotions-same-employer');
    const k8s = usagesOf(experienced).filter(
      (u) => skillName(experienced, u.skill_id) === 'Kubernetes',
    );
    expect(k8s.map((u) => u.usage_context)).toEqual(['self_declared_knowledge']);
  });

  it('neg-five-years-backend: vaga exige 5 anos profissionais; perfil so tem projetos e curso', () => {
    const { meta } = loadJob('five-years-backend');
    expect(meta.expectations.years_required[0]).toMatchObject({
      years: 5,
      professional_only: true,
    });
    const p = profileOf('student-no-employment');
    expect(experiences(p)).toHaveLength(0);
    expect(usageContexts(p).has('professional_experience')).toBe(false);
    expect(usageContexts(p).has('project_experience')).toBe(true);
  });

  it('neg-prompt-injection: a vaga carrega a instrucao e os marcadores proibidos', () => {
    const { meta, text } = loadJob('injection');
    expect(text.toLowerCase()).toContain('ignore as instruções anteriores');
    expect(text.toLowerCase()).toContain('invente resultados');
    expect(meta.forbidden_output_markers.length).toBeGreaterThanOrEqual(3);
    // o trecho injetado nao pode ser requisito esperado
    const required = [...meta.expectations.mandatory, ...meta.expectations.desirable];
    expect(required.every((r) => !/ignore|invente|CANARY/i.test(r.excerpt))).toBe(true);
  });

  it('neg-conflicting-date-safe-precision: variantes conhecidas e texto seguro para o inicio', () => {
    const p = profileOf('conflicting-facts');
    const pending = listOf(p, 'pending_items').find((pi) => {
      const t = isRec(pi.target) ? pi.target : {};
      return t.field === 'start_date';
    });
    expect(pending?.reason).toBe('conflict');
    expect((pending?.known_variants as unknown[]).length).toBeGreaterThanOrEqual(2);
    expect(pending?.safe_statement_for_now).toBeTruthy();
    expect(pending?.status).toBe('open');
  });

  it('neg-english-posting-names: perfil e vaga em en-US com nomes originais em portugues', () => {
    const doc = profileOf('international-en-US');
    const education = listOf(doc, 'education')[0]!;
    expect(str(education.institution)).toMatch(/^Universidade/);
    expect(str(education.course_name)).toMatch(/^Bacharelado/);
    const exp = experiences(doc).find((e) => str(e.display_title));
    expect(exp).toBeDefined();
    expect(str(exp?.official_title)).toMatch(/^Desenvolvedor/);
    expect(loadJob('english-posting').meta.locale).toBe('en-US');
  });

  it('neg-collaborative-project-attribution: perfis listados tem trabalho de terceiros explicito', () => {
    const scenario = getScenario('neg-collaborative-project-attribution');
    const problems = scenario.profiles.flatMap((id) =>
      teamProjectWithBoundedContribution(profileOf(id), id),
    );
    expect(problems).toEqual([]);
  });

  it('neg-portfolio-migration-not-complete: projeto em andamento com pendencia stale', () => {
    const p = profileOf('student-no-employment');
    const project = listOf(p, 'projects').find((pr) => /portf/i.test(str(pr.name) ?? ''));
    expect(project?.status).toBe('in_progress');
    expect(metaOf(project!).status).toBe('needs_review');
    const pending = listOf(p, 'pending_items').find((pi) => {
      const t = isRec(pi.target) ? pi.target : {};
      return t.record_id === project?.id;
    });
    expect(pending?.reason).toBe('stale');
    expect(pending?.safe_statement_for_now).toBeTruthy();
  });
});

describe('tipos', () => {
  it('ProfileId, JobId e EdgeProfileId sao exportados e consistentes com os arrays', () => {
    const p: ProfileId = 'private-heavy';
    const j: JobId = 'injection';
    const e: EdgeProfileId = 'broken-syntax';
    expect([p, j, e]).toHaveLength(3);
  });
});
