/**
 * Catalogo tipado das fixtures. Os ids sao literais para que `scenarios.ts` seja checado em tempo de
 * compilacao; o teste `catalog.test.ts` garante que catalogo e arquivos em disco coincidem exatamente.
 *
 * Todas as fixtures sao 100% ficticias (ver README.md).
 */

export type ProfileFormat = 'v2' | 'v1';
export type ProfileSeniority = 'student' | 'entry' | 'junior' | 'mid' | 'senior' | 'not_assessed';

export interface ProfileDescriptor {
  readonly id: string;
  /** `v2` = ProfileDocument 2.x (intercambio, snake_case; 2.1.0 corrente, 2.0.0 em algumas fixtures para provar a migracao aditiva). `v1` = legado 1.0.0 (so para migracao). */
  readonly format: ProfileFormat;
  readonly schemaVersion: '2.0.0' | '2.1.0' | '1.0.0';
  readonly locale: string;
  readonly country: string;
  readonly profession: string;
  readonly seniority: ProfileSeniority;
  /** O que a fixture exercita, em uma frase. */
  readonly summary: string;
}

export const PROFILES = [
  {
    id: 'student-no-employment',
    format: 'v2',
    schemaVersion: '2.0.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Estudante de Sistemas de Informação',
    seniority: 'student',
    summary:
      'Formação e projetos, sem emprego (experiences: []). Só JavaScript/Node/PostgreSQL: sem Java, sem Kubernetes. Projeto em equipe com contribuição delimitada, portfólio em migração, usos de competência de 6+ contextos.',
  },
  {
    id: 'experienced-promotions-same-employer',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Engenheiro de Software',
    seniority: 'senior',
    summary:
      'Quatro cargos no mesmo empregador (organization_group), experiência profissional real em Java/PostgreSQL, Kubernetes só como estudo declarado, item arquivado e métrica com linha de base e método.',
  },
  {
    id: 'career-changer-teacher-to-data',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Professora em transição para análise de dados',
    seniority: 'junior',
    summary:
      'Transição de educação para dados. Competências transferíveis (Excel, estatística, comunicação) vindas de experiência profissional; SQL/Python só em curso e projeto; métrica pendente com needs_confirmation.',
  },
  {
    id: 'non-tech-nurse',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Enfermeira (UTI adulto)',
    seniority: 'mid',
    summary:
      'Perfil não-TI: licença profissional, certificações com validade (ACLS vencido), voluntariado, idiomas com níveis diferentes por habilidade e field_states explícitos (not_applicable, declined, needs_confirmation).',
  },
  {
    id: 'non-tech-logistics',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Supervisor de armazém (logística)',
    seniority: 'senior',
    summary:
      'Perfil não-TI: métricas com linha de base/período/método, NR e CNH como licenças, vários cargos no mesmo empregador e restrição de uso sobre nome de cliente.',
  },
  {
    id: 'freelancer-confidential-clients',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Consultora autônoma de marketing digital B2B',
    seniority: 'senior',
    summary:
      'Autônoma com clientes sob NDA: nomes de clientes só em campos privados e restrições never_include; métrica que exige autorização; sem portfólio público (portfolio_url ausente: o contrato 2.0.0 não aceita field_states em campos aninhados como business.portfolio_url).',
  },
  {
    id: 'no-links-no-portfolio',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Técnico de manutenção elétrica industrial',
    seniority: 'senior',
    summary:
      'Nenhum link, portfólio ou evidência com URL; evidências em papel. O currículo não pode inventar links nem citar portfólio.',
  },
  {
    id: 'imprecise-dates',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-PT',
    country: 'PT',
    profession: 'Contabilista',
    seniority: 'senior',
    summary:
      'Datas em precisão ano, ano-mês e ano-mês-dia; start_date null; end_date null (diferente de present). Nunca aumentar a precisão; anos de experiência por intervalo mínimo/máximo.',
  },
  {
    id: 'conflicting-facts',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Executivo de contas B2B (agronegócio)',
    seniority: 'mid',
    summary:
      'Conflitos em período, cargo e métrica, cada um com pendência aberta, known_variants e safe_statement_for_now. Nenhuma variante pode ser afirmada como definitiva.',
  },
  {
    id: 'private-heavy',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Analista de Recursos Humanos',
    seniority: 'mid',
    summary:
      'Muitos dados privados/condicionais/never/archived com canários únicos (contato privado, vínculo omitido, métrica condicional, projeto privado, salário, restrições). Nada disso pode sair no documento nem no contexto de IA.',
  },
  {
    id: 'international-en-US',
    format: 'v2',
    schemaVersion: '2.1.0',
    locale: 'en-US',
    country: 'US',
    profession: 'Senior Software Engineer',
    seniority: 'senior',
    summary:
      'Locale en-US com formação brasileira: nomes de instituição, curso e cargo oficial em português não podem ser traduzidos; resume_display_title explícito; certificação vencida; contribuição open source em equipe.',
  },
  {
    id: 'minimal-partial',
    format: 'v2',
    schemaVersion: '2.0.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Atendente de loja',
    seniority: 'not_assessed',
    summary:
      'Perfil mínimo: nome, um e-mail e uma experiência sem datas. Listas vazias e campos null; nunca produzir texto negativo ("sem experiência"); deve gerar pendências, não valores.',
  },
  {
    id: 'legacy-1.0.0-filled',
    format: 'v1',
    schemaVersion: '1.0.0',
    locale: 'pt-BR',
    country: 'BR',
    profession: 'Engenheira Agrônoma',
    seniority: 'senior',
    summary:
      'Formato 1.0.0 preenchido para migração: "" e registros fantasma, fact_status declarado, quatro vocabulários de contexto, employment sem experiência relacionada, developing_knowledge, freelance_and_business, usage_rules em texto livre, consentimento dentro do arquivo.',
  },
] as const satisfies readonly ProfileDescriptor[];

export type ProfileId = (typeof PROFILES)[number]['id'];

export type EdgeExpectation =
  'accepted' | 'accepted_with_warnings' | 'rejected' | 'yaml_syntax_error';

export interface EdgeProfileDescriptor {
  readonly id: string;
  /**
   * Nome do arquivo em `profiles-edge/` (padrao `<id>.yaml`). YAML sintaticamente invalido usa extensao
   * `.yaml.txt` para que o Prettier (`pnpm format:check`) nao tente parseá-lo.
   */
  readonly file?: string;
  readonly expected: EdgeExpectation;
  /** Por que e esperado esse resultado (e o que o teste de importacao deve conferir). */
  readonly reason: string;
  /**
   * Fragmentos que DEVEM aparecer no `path` ou na `message` de algum erro da importacao estrita (ou no codigo de aviso,
   * quando `expected` e `accepted_with_warnings`). Verificado por test/contract-validation.test.ts contra o contrato real.
   * Obs.: erros de integridade citam o indice (`skill_usages[0]`), nao o id local; chaves desconhecidas citam a chave.
   */
  readonly expectedIssues: readonly string[];
}

/** Casos de borda de importacao (parcial/malformado). Nao sao perfis completos. */
export const EDGE_PROFILES = [
  {
    id: 'empty-profile',
    expected: 'accepted',
    reason: 'Perfil vazio é válido (perfil parcial); gera 0 registros.',
    expectedIssues: [],
  },
  {
    id: 'all-null-fields',
    expected: 'accepted',
    reason: 'null = not_provided e [] = nenhum item; ambos válidos em todo campo anulável.',
    expectedIssues: [],
  },
  {
    id: 'unknown-key',
    expected: 'rejected',
    reason:
      'Chave desconhecida (typo) em profile. Estrito: erro (path `profile`, mensagem cita a chave). Lenient: aviso UNKNOWN_KEY_UNMAPPED + valor em `unmapped`.',
    expectedIssues: ['profile', 'typo_experinces'],
  },
  {
    id: 'invalid-enums',
    expected: 'rejected',
    reason: 'Valores fora dos enums canônicos (employment_type, nível, usage_context, idioma).',
    expectedIssues: ['employment_type', 'self_assessed_level', 'usage_context', 'overall'],
  },
  {
    id: 'free-text-date-url-email',
    expected: 'rejected',
    reason: 'Data em texto livre, mês 13, URL e e-mail inválidos.',
    expectedIssues: ['start_date', 'end_date', 'value'],
  },
  {
    id: 'duplicate-ids',
    expected: 'rejected',
    reason: 'Ids duplicados no mesmo documento (integridade, superRefine).',
    expectedIssues: ['EXP-001'],
  },
  {
    id: 'dangling-references',
    expected: 'rejected',
    reason: 'evidence_ids, skill_id, supports e target.record_id apontando para ids inexistentes.',
    expectedIssues: ['EVD-404', 'SKL-404', 'EXP-404', 'PRJ-404'],
  },
  {
    id: 'incoherent-usage-context',
    expected: 'rejected',
    reason:
      'ADR-0007: professional_experience sem experience_id; project_experience com fonte de experiência; duas fontes no mesmo uso.',
    expectedIssues: ['skill_usages[0]', 'skill_usages[1]', 'skill_usages[2]'],
  },
  {
    id: 'wrong-types',
    expected: 'rejected',
    reason: 'Tipos errados: número onde há string/enum, valor negativo, lista no lugar de objeto.',
    expectedIssues: ['name', 'usage_context', 'amount', 'identity'],
  },
  {
    id: 'empty-strings-and-phantoms',
    expected: 'accepted_with_warnings',
    reason:
      '"" vira null (EMPTY_STRING_NORMALIZED) e registros só com "" são descartados (EMPTY_RECORD_DROPPED). Resultado: 1 experiência, 0 formações, 0 competências.',
    expectedIssues: ['EMPTY_STRING_NORMALIZED', 'EMPTY_RECORD_DROPPED'],
  },
  {
    id: 'unsupported-schema-version',
    expected: 'rejected',
    reason: 'schema_version 0.9.0 não tem cadeia de migração.',
    expectedIssues: ['schema_version'],
  },
  {
    id: 'missing-schema-version',
    expected: 'rejected',
    reason: 'Sem schema_version o formato não é identificável.',
    expectedIssues: ['schema_version'],
  },
  {
    id: 'broken-syntax',
    file: 'broken-syntax.yaml.txt',
    expected: 'yaml_syntax_error',
    reason: 'YAML inválido (indentação e colchete aberto): erro de parse antes da validação.',
    expectedIssues: [],
  },
] as const satisfies readonly EdgeProfileDescriptor[];

export type EdgeProfileId = (typeof EDGE_PROFILES)[number]['id'];

export const JOB_IDS = [
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
  'data-analyst-junior',
] as const;

export type JobId = (typeof JOB_IDS)[number];

/** Trecho de requisito esperado; `excerpt` deve estar contido literalmente no texto da vaga. */
export interface ExpectedRequirement {
  readonly text: string;
  readonly excerpt: string;
}

export interface ExpectedYears {
  readonly term: string;
  readonly years: number;
  /** Anos contam apenas experiência profissional (ADR-0011): projetos e cursos nunca somam. */
  readonly professional_only: boolean;
  readonly excerpt: string;
}

/** Resultado esperado de extração (provisório; S3.5/S4.5 podem refinar). `null` = ausente na vaga. */
export interface JobExpectations {
  readonly company: string | null;
  readonly salary: string | null;
  readonly work_mode: 'remote' | 'hybrid' | 'onsite' | null;
  readonly location: string | null;
  readonly mandatory: readonly ExpectedRequirement[];
  readonly desirable: readonly ExpectedRequirement[];
  readonly responsibilities: readonly ExpectedRequirement[];
  readonly years_required: readonly ExpectedYears[];
}

export interface JobMeta {
  readonly id: JobId;
  readonly title: string;
  readonly locale: string;
  readonly description: string;
  readonly scenario_ids: readonly string[];
  readonly target_profiles: readonly ProfileId[];
  readonly expectations: JobExpectations;
  /** Strings que NUNCA podem aparecer em saída gerada para esta vaga (ex.: canário de injeção). */
  readonly forbidden_output_markers: readonly string[];
  readonly notes: string;
}
