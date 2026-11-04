import { describe, expect, it } from 'vitest';
import { importProfile, loadProfile, parseProfileText, type LoadResult } from '../src/index';
import { legacyFilledYaml, legacyTemplateYaml } from './fixtures';

const codesOf = (result: LoadResult) => result.report.warnings.map((w) => w.code);
const countCode = (result: LoadResult, code: string) =>
  codesOf(result).filter((c) => c === code).length;
const byId = <T extends { id?: string | null }>(items: T[] | null | undefined, id: string) =>
  items?.find((i) => i.id === id);

describe('migracao 1.0.0 -> 2.0.0: template vazio da raiz (copia)', () => {
  const result = loadProfile(legacyTemplateYaml());

  it('migra e valida no contrato 2.0.0', () => {
    expect(result.ok).toBe(true);
    expect(result.report.errors).toEqual([]);
    expect(result.report.source_schema_version).toBe('1.0.0');
    expect(result.report.target_schema_version).toBe('2.1.0');
    expect(result.report.source_format).toBe('yaml');
  });

  it('descarta os 16 registros-modelo fantasma e nao cria nenhum registro', () => {
    expect(countCode(result, 'EMPTY_RECORD_DROPPED')).toBe(16);
    expect(result.document?.profile).toEqual({});
    expect(result.document?.locale).toBe('pt-BR');
  });

  it('registra EMPTY_STRING_NORMALIZED (por bloco) e os passos da migracao', () => {
    expect(countCode(result, 'EMPTY_STRING_NORMALIZED')).toBeGreaterThanOrEqual(5);
    const paths = result.report.warnings
      .filter((w) => w.code === 'EMPTY_STRING_NORMALIZED')
      .map((w) => w.path);
    expect(paths).toEqual(
      expect.arrayContaining(['profile.identity', 'profile.positioning', 'profile.contact']),
    );
    expect(result.report.steps.map((s) => s.id)).toEqual([
      'parse',
      'v1_0_0_to_v2_1_0',
      'normalize',
      'validate',
    ]);
    const migration = result.report.steps.find((s) => s.id === 'v1_0_0_to_v2_1_0');
    expect(migration).toMatchObject({ from: '1.0.0', to: '2.1.0' });
  });

  it('defaults do modelo (confirmed, professional, public, pt-BR...) nao viram fatos', () => {
    const text = JSON.stringify(result.document);
    for (const banned of [
      'confirmed',
      'professional',
      'public',
      'in_progress',
      'allowed',
      'self',
      'article',
    ]) {
      expect(text, banned).not.toContain(`"${banned}"`);
    }
  });

  it('importProfile do template: 0 registros, nada a criar', () => {
    const imported = importProfile(legacyTemplateYaml());
    expect(imported.ok).toBe(true);
    expect(imported.preview?.totals).toMatchObject({
      records: 0,
      create: 0,
      update: 0,
      discarded: 16,
    });
  });
});

describe('migracao 1.0.0 -> 2.0.0: perfil preenchido sintetico', () => {
  const result = loadProfile(legacyFilledYaml());
  const doc = result.document!;
  const profile = doc.profile;

  it('migra e produz um documento 2.0.0 valido (sem erros)', () => {
    expect(result.report.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(doc.schema_version).toBe('2.1.0');
  });

  it('descarta apenas os registros-modelo (ghosts) e conta cada um', () => {
    // EXP-099, link vazio, atividade vazia, tecnologia sem nome
    expect(countCode(result, 'EMPTY_RECORD_DROPPED')).toBe(4);
    expect(byId(profile.experiences, 'EXP-099')).toBeUndefined();
  });

  it('fact_status vira meta.declared_status e todo status vira needs_review (plano 7.1)', () => {
    const exp1 = byId(profile.experiences, 'EXP-001');
    expect(exp1?.meta).toMatchObject({
      status: 'needs_review',
      declared_status: 'confirmed',
      source: 'profile_import',
    });
    expect(byId(profile.experiences, 'EXP-003')?.meta).toMatchObject({
      status: 'needs_review',
      declared_status: 'conflicting',
    });
    expect(byId(profile.projects, 'PRJ-001')?.meta).toMatchObject({
      status: 'needs_review',
      declared_status: 'confirmed',
    });
    expect(byId(profile.education, 'EDU-001')?.meta).toMatchObject({
      status: 'needs_review',
      declared_status: 'confirmed',
    });
    // nenhum fato sai confirmado
    const statuses = JSON.stringify(doc).match(/"status":"(\w+)"/g) ?? [];
    expect(
      statuses.filter(
        (s) => s.includes('confirmed') || s.includes('archived') || s.includes('conflicting'),
      ),
    ).toEqual([]);
    expect(codesOf(result)).toContain('DECLARED_STATUS_PRESERVED');
    expect(codesOf(result)).toContain('STATUS_SET_NEEDS_REVIEW');
  });

  it('is_current: true + end_date vazio -> end_date "present"; conflito mantem a data e marca needs_confirmation', () => {
    expect(byId(profile.experiences, 'EXP-001')?.end_date).toBe('present');
    const conflict = byId(profile.experiences, 'EXP-003');
    expect(conflict?.end_date).toBe('2013-06');
    expect(conflict?.meta?.field_states).toEqual({ end_date: 'needs_confirmation' });
    expect(countCode(result, 'IS_CURRENT_CONFLICT')).toBe(1);
  });

  it('enum legado e normalizado (apprentice -> apprenticeship) e invalido vai para meta.private_notes (nada se perde)', () => {
    expect(byId(profile.experiences, 'EXP-003')?.employment_type).toBe('apprenticeship');
    const invalid = byId(profile.experiences, 'EXP-004');
    expect(invalid?.employment_type).toBeUndefined();
    expect(invalid?.start_date).toBeUndefined();
    expect(invalid?.meta?.private_notes).toContain('freelancer-pj');
    expect(invalid?.meta?.private_notes).toContain('ano passado');
    expect(countCode(result, 'INVALID_VALUE_MOVED_TO_NOTES')).toBeGreaterThanOrEqual(4);
  });

  it('responsabilidades, conquistas e entregas viram items[] com kind; divulgacao vira resume_use', () => {
    const items = byId(profile.experiences, 'EXP-001')?.items ?? [];
    expect(items.map((i) => i.kind)).toEqual([
      'responsibility',
      'achievement',
      'achievement',
      'delivery',
    ]);
    expect(items[1]).toMatchObject({
      text: 'Reducao do tempo medio de separacao de pedidos.',
      metric: {
        name: 'Tempo medio de separacao',
        value: '-18%',
        baseline: '42 min',
        period: '2021-2022',
        method: 'Media mensal do WMS',
      },
      meta: { resume_use: 'allowed' },
    });
    expect(items[2]?.meta?.resume_use).toBe('requires_approval'); // restricted
    expect(items[3]?.meta?.resume_use).toBe('never'); // not_approved
    expect(items.every((i) => i.id)).toBe(true);
    expect(countCode(result, 'DISCLOSURE_MAPPED')).toBeGreaterThanOrEqual(3);
  });

  it('technologies_used: contexto do 1.0.0 -> vocabulario do ADR-0007, ligado a experiencia; sem promover contexto', () => {
    const usages = (profile.skill_usages ?? []).filter((u) => u.experience_id === 'EXP-001');
    const skillName = (id: string) => profile.skills?.find((s) => s.id === id)?.name;
    const contextOf = (name: string) =>
      usages.find((u) => skillName(u.skill_id) === name)?.usage_context;
    expect(contextOf('Sistema WMS')).toBe('professional_experience');
    expect(contextOf('Painel de indicadores internos')).toBe('professional_experience'); // internal_project
    expect(contextOf('Logistica reversa')).toBe('self_declared_knowledge'); // study
    expect(contextOf('Auditoria interna')).toBe('unverified'); // training: sem treinamento cadastrado
    expect(contextOf('Cross-docking')).toBe('unverified'); // other
    // tecnologia vem de responsabilidade e de entrega interna tambem
    expect(contextOf('Planilhas eletronicas')).toBe('professional_experience');
    expect(contextOf('Coletores de dados')).toBe('professional_experience');
    // nenhum uso verificavel sem fonte coerente (ja garantido pelo contrato; reforca)
    for (const usage of profile.skill_usages ?? []) {
      if (usage.usage_context === 'professional_experience')
        expect(usage.experience_id).toBeTruthy();
    }
  });

  it('training sem fonte -> unverified + pendencia criada; employment sem experiencia relacionada idem', () => {
    const skill = (name: string) => profile.skills?.find((s) => s.name === name);
    const trainingUsage = profile.skill_usages?.find(
      (u) => u.skill_id === skill('Auditoria interna')?.id,
    );
    expect(trainingUsage?.usage_context).toBe('unverified');
    const pending = profile.pending_items?.filter((p) => p.target?.record_id === trainingUsage?.id);
    expect(pending).toHaveLength(1);
    expect(pending?.[0]).toMatchObject({ reason: 'unclear', priority: 'medium', status: 'open' });

    const employmentNoLink = profile.skill_usages?.find(
      (u) =>
        u.skill_id === skill('Roteirizacao de entregas')?.id && u.usage_context === 'unverified',
    );
    expect(employmentNoLink).toBeTruthy();
    expect(profile.pending_items?.some((p) => p.target?.record_id === employmentNoLink?.id)).toBe(
      true,
    );
    // self_study vira self_declared_knowledge
    expect(
      profile.skill_usages?.some(
        (u) =>
          u.skill_id === skill('Roteirizacao de entregas')?.id &&
          u.usage_context === 'self_declared_knowledge',
      ),
    ).toBe(true);

    // course e volunteer sem fonte relacionada
    expect(
      profile.skill_usages?.some(
        (u) => u.skill_id === skill('Ingles tecnico')?.id && u.usage_context === 'unverified',
      ),
    ).toBe(true);
    expect(
      profile.skill_usages?.some(
        (u) => u.skill_id === skill('Mentoria de equipes')?.id && u.usage_context === 'unverified',
      ),
    ).toBe(true);
    expect(countCode(result, 'USAGE_CONTEXT_UNVERIFIED')).toBeGreaterThanOrEqual(5);
    expect(countCode(result, 'PENDING_ITEM_CREATED')).toBeGreaterThanOrEqual(4);
  });

  it('skills[] com related_*_ids resolve contextos e deduplica por chave normalizada (SKILL_MERGED)', () => {
    const planilhas =
      profile.skills?.filter((s) => s.name?.toLowerCase() === 'planilhas eletronicas') ?? [];
    expect(planilhas).toHaveLength(1);
    const usages = profile.skill_usages?.filter((u) => u.skill_id === planilhas[0]?.id) ?? [];
    expect(
      usages.some(
        (u) => u.usage_context === 'professional_experience' && u.experience_id === 'EXP-001',
      ),
    ).toBe(true);
    expect(
      usages.some((u) => u.usage_context === 'project_experience' && u.project_id === 'PRJ-001'),
    ).toBe(true);
    expect(countCode(result, 'SKILL_MERGED')).toBe(2);
    // resume_usage -> resume_use, evidencias, nivel e categoria
    expect(planilhas[0]).toMatchObject({ category: 'tool', self_assessed_level: 'advanced' });
    // include (SKL-001) x depending_on_job (SKL-005 duplicada): vence o mais restritivo
    expect(planilhas[0]?.meta?.resume_use).toBe('requires_approval');
    expect(planilhas[0]?.meta?.evidence_ids).toContain('EVD-002');
    // related ids nao resolvidos viram aviso, nao erro
    expect(
      result.report.warnings.some(
        (w) => w.code === 'REFERENCE_UNRESOLVED' && w.message.includes('EXP-404'),
      ),
    ).toBe(true);
  });

  it('developing_knowledge -> competencia + uso conceptual/self_declared com requires_approval e plano de estudo', () => {
    const sql = profile.skills?.find((s) => s.name === 'Analise de dados com SQL');
    expect(sql?.study_plan).toMatchObject({
      scope: 'Consultas basicas e agregacoes',
      next_goal: 'Consultas com juncoes',
    });
    expect(profile.skill_usages?.find((u) => u.skill_id === sql?.id)).toMatchObject({
      usage_context: 'self_declared_knowledge',
      meta: { resume_use: 'requires_approval' },
    });
    const sustain = profile.skills?.find(
      (s) => s.name === 'Sustentabilidade em cadeias de suprimentos',
    );
    expect(profile.skill_usages?.find((u) => u.skill_id === sustain?.id)?.usage_context).toBe(
      'conceptual_familiarity',
    );
  });

  it('projeto: tecnologias por faceta -> usos project_experience; itens por kind; is_public true -> public; false nao vira fato', () => {
    const project = byId(profile.projects, 'PRJ-001');
    expect(project?.items?.map((i) => i.kind)).toEqual(
      expect.arrayContaining([
        'feature',
        'workflow',
        'business_rule',
        'decision',
        'deliverable',
        'outcome',
        'test',
        'metric',
      ]),
    );
    expect(project?.public_access).toBe('public');
    expect(project?.team_based).toBe(true);
    expect(project?.collaborators).toHaveLength(1);
    const facets = profile.skill_usages
      ?.filter((u) => u.project_id === 'PRJ-001')
      .map((u) => u.facet)
      .filter(Boolean);
    expect(facets).toEqual(
      expect.arrayContaining([
        'frontend',
        'databases',
        'infrastructure_deployment',
        'testing_quality',
        'documentation',
        'methods_and_version_control',
      ]),
    );
    expect(project?.meta?.resume_use).toBe('allowed'); // disclosure approved
    expect(project?.documentation_url).toBeUndefined(); // "docs interna" nao e URL
    expect(project?.meta?.private_notes).toContain('docs interna');
    const metric = project?.items?.find((i) => i.kind === 'metric');
    expect(metric).toMatchObject({
      metric: { name: 'Operadores usando', value: '3' },
      meta: { resume_use: 'allowed', evidence_ids: ['EVD-002'] },
    });
  });

  it('contatos viram contact_points (visibilidade preservada); link invalido vai para unmapped; ghost descartado', () => {
    const contacts = profile.contact_points ?? [];
    expect(contacts.map((c) => c.kind)).toEqual(['email', 'phone', 'link']);
    expect(contacts[2]).toMatchObject({
      subtype: 'linkedin',
      visibility: 'public',
      include_by_default: true,
    });
    const droppedLink = result.report.unmapped.find((u) => u.path === 'profile.contact.links[1]');
    expect(droppedLink?.value).toMatchObject({
      url: 'meu site pessoal',
      label: 'Portfolio',
      type: 'portfolio',
    });
  });

  it('positioning: resumo, narrativa, diferenciais e valores viram statements; narrativa e privada', () => {
    const statements = profile.statements ?? [];
    expect(statements.map((s) => s.kind)).toEqual([
      'one_sentence_intro',
      'short_summary',
      'full_summary',
      'career_narrative',
      'differentiator',
      'value',
      'value',
    ]);
    const narrative = statements.find((s) => s.kind === 'career_narrative');
    expect(narrative?.meta?.visibility).toBe('private');
    expect(profile.positioning).toMatchObject({
      current_profession: 'Coordenacao de logistica',
      current_seniority: 'senior',
    });
    expect(profile.positioning).not.toHaveProperty('one_sentence_intro');
  });

  it('campos duplicados entre positioning e career_preferences viram uniao sem duplicatas', () => {
    expect(profile.career_preferences).toMatchObject({
      priority_job_titles: [
        'Coordenadora de Logistica',
        'Gerente de Operacoes',
        'Supervisora de Operacoes',
      ],
      excluded_job_titles: ['Vendedora externa'],
      fields_of_interest: [
        'Logistica',
        'Cadeia de suprimentos',
        'Ensino tecnico',
        'Gestao de operacoes',
      ],
      preferred_industries: ['Varejo', 'Saude', 'Industria'],
      excluded_industries: ['Tabaco', 'Armas'],
      professional_interests: ['Melhoria continua'],
      problems_to_solve: ['Reducao de ruptura de estoque'],
      short_term_goals: 'Assumir uma gerencia de operacoes.',
      interest_in_adjacent_fields: 'depends',
    });
    expect(profile.career_preferences?.target_seniority_levels).toEqual(['senior', 'manager']); // "chefe-geral" invalido
    expect(countCode(result, 'FIELD_MERGED')).toBeGreaterThanOrEqual(4);
  });

  it('freelance_and_business vira experiencia (employment_type freelance) com business, itens e restricao de nomes de clientes', () => {
    const freelance = profile.experiences?.find(
      (e) => e.organization_name === 'Consultoria de Armazens H. Duarte',
    );
    expect(freelance).toMatchObject({
      employment_type: 'freelance',
      start_date: '2020',
      end_date: '2021',
      business: {
        activity: 'Consultoria de layout de armazens',
        client_count: 5,
        services_scope: ['Diagnostico de layout'],
      },
    });
    expect(freelance?.items?.map((i) => i.kind)).toEqual([
      'responsibility',
      'delivery',
      'achievement',
    ]);
    const restriction = profile.usage_rules?.restrictions?.find(
      (r) => r.target.record_id === freelance?.id,
    );
    expect(restriction).toMatchObject({
      rule: 'never_include',
      target: { field: 'organization_name' },
    });
    expect(countCode(result, 'CLIENT_NAMES_RESTRICTION_ADDED')).toBe(1);
    expect(countCode(result, 'RECORD_RELOCATED')).toBe(1);
  });

  it('usage_rules em texto livre viram restricoes por termo, com a regra da lista de origem', () => {
    const terms = (rule: string) =>
      profile.usage_rules?.restrictions
        ?.filter((r) => r.rule === rule && r.target.term)
        .map((r) => r.target.term);
    expect(terms('never_include')).toEqual(
      expect.arrayContaining(['Motivo de saida de empregos anteriores', 'Cliente piloto sigiloso']),
    );
    expect(terms('require_approval')).toEqual(['Metricas financeiras']);
    expect(terms('private_guidance_only')).toEqual(['Pretensao salarial']);
  });

  it('disponibilidade: privacy != private gera aviso; salario normalizado; texto livre de viagens vai para travel_notes', () => {
    expect(countCode(result, 'PRIVACY_FORCED_PRIVATE')).toBe(1);
    expect(profile.availability_preferences).toMatchObject({
      preferred_work_modes: ['hybrid'],
      willing_to_relocate: 'depends',
      travel_notes: 'ate 30% das semanas',
      preferred_contract_types: ['employee', 'contractor'], // CLT, PJ
      salary_expectation: { amount: 12000, currency: 'BRL', period: 'monthly' },
    });
    expect(profile.availability_preferences).not.toHaveProperty('privacy');
    expect(profile.availability_preferences).not.toHaveProperty('travel_availability');
  });

  it('resume_preferences: boolean de foto vira enum, formatos/secoes invalidos nao entram, referencias viram ids', () => {
    expect(profile.resume_preferences).toMatchObject({
      photo_preference: 'never',
      output_formats: ['docx', 'pdf'],
      preferred_sections: ['experience', 'education'],
      older_experience_ids: ['EXP-003'],
      highlight_record_ids: ['PRJ-001'],
    });
    expect(profile.resume_preferences?.additional_style_notes).toContain('Estagio de 2011');
    expect(
      result.report.unmapped.some((u) => u.path.endsWith('output_formats') && u.value === 'odt'),
    ).toBe(true);
  });

  it('consentimento dentro do arquivo e ignorado (aviso), nunca registrado; datas de revisao preservadas', () => {
    expect(countCode(result, 'CONSENT_IN_FILE_NOT_RECORDED')).toBe(1);
    expect(JSON.stringify(doc)).not.toContain('processing_consent');
    expect(JSON.stringify(doc)).not.toContain('granted');
    expect(profile.review).toEqual({
      profile_created_date: '2024-01-10',
      last_reviewed_date: '2024-03-02',
      reviewed_by: 'self',
      reviewed_sections: ['experiences'],
    });
  });

  it('evidencias: supported_claims vao para notes; aprovacao para recrutadores vira recruiter_sharing; referencias sem alvo viram aviso', () => {
    const evidence = profile.evidence ?? [];
    expect(evidence).toHaveLength(2);
    expect(evidence[0]).toMatchObject({
      id: 'EVD-001',
      type: 'document',
      recruiter_sharing: 'not_allowed',
      is_public: false,
    });
    expect(evidence[0]?.notes).toContain('Acuracidade de 99,2%');
    expect(evidence[1]).toMatchObject({ recruiter_sharing: 'allowed', is_public: true });
    const exp1 = byId(profile.experiences, 'EXP-001');
    expect(exp1?.meta?.evidence_ids).toEqual(['EVD-001']);
    expect(exp1?.meta?.private_notes).toContain('EVD-999');
  });

  it('pendencias: ignored -> dismissed, motivo inferido unclear; ghost nao entra', () => {
    const pendings = profile.pending_items?.filter((p) => p.id?.startsWith('PEND')) ?? [];
    expect(pendings.map((p) => [p.id, p.status, p.reason])).toEqual([
      ['PEND-001', 'open', 'unclear'],
      ['PEND-002', 'dismissed', 'unclear'],
    ]);
    expect(pendings[0]).toMatchObject({
      reason_detail: 'Memoria incompleta',
      known_variants: ['2013-06', '2013-09'],
      priority: 'high',
    });
  });

  it('chaves desconhecidas do 1.0.0 sao preservadas em unmapped com aviso (nunca em silencio)', () => {
    const paths = result.report.unmapped.map((u) => u.path);
    expect(paths).toContain('profile.typo_section');
    expect(paths).toContain('profile.experiences[0].extra_field_typo');
    expect(countCode(result, 'UNKNOWN_KEY_UNMAPPED')).toBe(2);
  });

  it('identificadores: ids 1.0.0 mantidos; ids novos nao colidem; todos unicos', () => {
    const ids = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === 'id' && typeof value === 'string') {
            expect(ids.has(value), `id duplicado ${value}`).toBe(false);
            ids.add(value);
          } else walk(value);
        }
      }
    };
    walk(doc.profile);
    expect(
      ids.has('EXP-001') &&
        ids.has('PRJ-001') &&
        ids.has('EDU-001') &&
        ids.has('CERT-001') &&
        ids.has('EVD-001'),
    ).toBe(true);
    expect(ids.size).toBeGreaterThan(60);
  });

  it('nenhum texto livre do 1.0.0 se perde: cada trecho esta no documento 2.0.0 ou em unmapped', () => {
    const parsed = parseProfileText(legacyFilledYaml());
    expect(parsed.ok).toBe(true);
    const leaves: string[] = [];
    const walk = (node: unknown): void => {
      if (typeof node === 'string') leaves.push(node);
      else if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') Object.values(node).forEach(walk);
    };
    walk(parsed.ok ? parsed.data.profile : null);
    const haystack = JSON.stringify(doc) + JSON.stringify(result.report.unmapped);
    const intentionallyDropped = new Set([
      'public', // privacy: valor descartado com aviso (privado por construcao)
      'granted', // consentimento: nao e registrado
      'Consentimento declarado no arquivo', // idem
      'URL digitada sem formato valido', // nota do usuario sobre link invalido: link inteiro foi para unmapped
      'EXP-404', // referencia a registro inexistente: reportada no aviso REFERENCE_UNRESOLVED
      'Estagio de 2011', // movido para additional_style_notes (verificado em outro teste)
      // valores de enum do 1.0.0 traduzidos para o vocabulario 2.0.0 (nao sao texto livre)
      'restricted',
      'internal_project',
      'not_applicable',
      'not_specified',
      'self_study',
      'depending_on_job',
      // transformados de forma estruturada
      '2019-12 a atual', // usage_period -> start_date/end_date
      'PLANILHAS ELETRONICAS', // duplicata da competencia (mesma chave normalizada)
      'doi:10.1234/exemplo.2021.01', // -> publications[].doi
      '+55 19 90000-0000', // telefone -> forma canonica (+5519900000000): so a formatacao muda
    ]);
    const missing = leaves
      .filter((text) => text.trim().length >= 8 && !intentionallyDropped.has(text))
      .filter((text) => !haystack.includes(JSON.stringify(text).slice(1, -1)));
    expect(missing).toEqual([]);
  });
});

describe('migracao: versoes e entradas invalidas', () => {
  it('versao desconhecida (9.9.9), antiga (0.9.0) e ausente sao rejeitadas com erro claro', () => {
    for (const [version, code] of [
      ['9.9.9', 'VERSION_FUTURE'],
      ['0.9.0', 'VERSION_UNSUPPORTED'],
    ] as const) {
      const result = loadProfile(`schema_version: "${version}"\nprofile: {}\n`);
      expect(result.ok).toBe(false);
      expect(result.document).toBeNull();
      expect(result.report.errors[0]).toMatchObject({ path: 'schema_version', code });
    }
    const missing = loadProfile('profile: {}\n');
    expect(missing.report.errors[0]?.code).toBe('VERSION_MISSING');
  });

  it('documento 1.0.0 estruturalmente invalido nao migra (LEGACY_INVALID com caminho)', () => {
    const result = loadProfile('schema_version: "1.0.0"\nprofile:\n  experiences: texto\n');
    expect(result.ok).toBe(false);
    expect(result.report.errors[0]).toMatchObject({ code: 'LEGACY_INVALID' });
    expect(result.report.errors[0]?.path).toContain('experiences');
  });

  it('1.0.0 minimo ({profile: {}}) migra para perfil vazio', () => {
    const result = loadProfile({ schema_version: '1.0.0', profile: {} });
    expect(result.ok).toBe(true);
    expect(result.document).toEqual({ schema_version: '2.1.0', profile: {} });
  });

  it('textos acima do limite do 2.0.0 sao truncados com aviso e o original fica em unmapped', () => {
    const long = 'x'.repeat(2_500);
    const result = loadProfile({
      schema_version: '1.0.0',
      profile: { projects: [{ name: 'P', problem: long }] },
    });
    expect(result.ok).toBe(true);
    expect(result.document?.profile.projects?.[0]?.problem).toHaveLength(2_000);
    expect(result.report.warnings.some((w) => w.code === 'TEXT_TRUNCATED')).toBe(true);
    expect(result.report.unmapped.some((u) => u.value === long)).toBe(true);
  });

  it('valores negativos/invalidos de salario e moeda nao quebram a migracao (descartados com aviso)', () => {
    const result = loadProfile({
      schema_version: '1.0.0',
      profile: {
        availability_preferences: {
          salary_expectation: { amount: -5, currency: 'reais', period: 'monthly' },
          preferred_work_modes: ['remote'],
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(result.document?.profile.availability_preferences).toEqual({
      preferred_work_modes: ['remote'],
      salary_expectation: { period: 'monthly' },
    });
    expect(result.report.warnings.filter((w) => w.code === 'INVALID_VALUE_DROPPED')).toHaveLength(
      2,
    );
  });

  it('ids 1.0.0 duplicados e invalidos sao renomeados com aviso; referencias seguem o primeiro', () => {
    const result = loadProfile({
      schema_version: '1.0.0',
      profile: {
        experiences: [
          { id: 'EXP-001', organization: 'A' },
          { id: 'EXP-001', organization: 'B' },
          { id: 'id com espaco', organization: 'C' },
        ],
        skills: [
          { name: 'S', acquisition_contexts: ['employment'], related_experience_ids: ['EXP-001'] },
        ],
      },
    });
    expect(result.ok).toBe(true);
    const experiences = result.document?.profile.experiences ?? [];
    expect(new Set(experiences.map((e) => e.id)).size).toBe(3);
    expect(experiences[0]?.id).toBe('EXP-001');
    expect(result.report.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_ID_RENAMED', 'ID_REMAPPED']),
    );
    expect(result.document?.profile.skill_usages?.[0]).toMatchObject({
      usage_context: 'professional_experience',
      experience_id: 'EXP-001',
    });
  });

  it('perfil em ingles gera textos de apoio em ingles (pendencias)', () => {
    const result = loadProfile({
      locale: 'en-US',
      schema_version: '1.0.0',
      profile: { skills: [{ name: 'Excel', acquisition_contexts: ['employment'] }] },
    });
    expect(result.document?.profile.pending_items?.[0]?.subject).toBe(
      'Confirm how "Excel" was used',
    );
  });
});
