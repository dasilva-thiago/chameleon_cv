import {
  type AUTONOMY_VALUES,
  type AWARD_SCOPE_VALUES,
  type CERTIFICATION_CATEGORY_VALUES,
  type CERTIFICATION_STATUS_VALUES,
  type CONTACT_KIND_VALUES,
  type CONTACT_SUBTYPE_VALUES,
  type COURSE_STATUS_VALUES,
  type DEGREE_TYPE_VALUES,
  type EDUCATION_STATUS_VALUES,
  type EMPLOYMENT_TYPE_VALUES,
  type EVIDENCE_TYPE_VALUES,
  type EXPERIENCE_ITEM_KIND_VALUES,
  type FACT_STATUS_VALUES,
  type FIELD_STATE_VALUES,
  type FREQUENCY_VALUES,
  type LANGUAGE_LEVEL_VALUES,
  type OUTPUT_FORMAT_VALUES,
  type PARTICIPATION_TYPE_VALUES,
  type PENDING_REASON_VALUES,
  type PENDING_STATUS_VALUES,
  type PHOTO_PREFERENCE_VALUES,
  type PREFERRED_LENGTH_VALUES,
  type PRIORITY_VALUES,
  type PROJECT_CATEGORY_VALUES,
  type PROJECT_ITEM_KIND_VALUES,
  type PROJECT_STATUS_VALUES,
  type PUBLICATION_STATUS_VALUES,
  type PUBLICATION_TYPE_VALUES,
  type PUBLIC_ACCESS_VALUES,
  type RECORD_KIND_VALUES,
  type RECRUITER_SHARING_VALUES,
  type REFERENCE_PERMISSION_VALUES,
  type RESTRICTION_RULE_VALUES,
  type RESUME_SECTION_VALUES,
  type RESUME_USE_VALUES,
  type REVIEWED_BY_VALUES,
  type SALARY_PERIOD_VALUES,
  type SELF_ASSESSED_LEVEL_VALUES,
  type SENIORITY_VALUES,
  type SKILL_CATEGORY_VALUES,
  type STATEMENT_KIND_VALUES,
  type STUDY_MODALITY_VALUES,
  type TONE_VALUES,
  type TRI_STATE_VALUES,
  type USAGE_CONTEXT_VALUES,
  type VISIBILITY_VALUES,
  type VISUAL_STYLE_VALUES,
  type WORK_MODE_VALUES,
} from '@chameleon/contracts';

/**
 * Rotulos em pt-BR dos vocabularios do contrato. O tipo `Labels<T>` obriga a cobrir todos os
 * valores do enum: se o contrato ganhar um valor, o typecheck acusa o rotulo faltante.
 */
type Labels<T extends readonly string[]> = Record<T[number], string>;

export interface Option {
  value: string;
  label: string;
}

export function optionsOf<T extends readonly string[]>(
  values: T,
  labels: Labels<T>,
  only?: readonly T[number][],
): Option[] {
  return (only ?? values).map((value) => ({ value, label: labels[value] }));
}

export const STATUS_LABELS: Labels<typeof FACT_STATUS_VALUES> = {
  confirmed: 'Confirmado',
  needs_review: 'Precisa de revisão',
  conflicting: 'Em conflito',
  archived: 'Arquivado',
};

export const STATUS_HELP: Labels<typeof FACT_STATUS_VALUES> = {
  confirmed:
    'Você revisou e confirma que a informação está correta. Só estes itens sustentam afirmações.',
  needs_review:
    'Ainda não foi revisado. Pode aparecer apenas como sugestão marcada, nunca como fato.',
  conflicting:
    'Há informações divergentes sobre este item. Registre a dúvida em Pendências para resolver.',
  archived: 'Guardado, mas fora de uso: não entra em currículos nem em análises.',
};

export const VISIBILITY_LABELS: Labels<typeof VISIBILITY_VALUES> = {
  public: 'Pública',
  private: 'Privada',
  conditional: 'Condicional',
};

export const VISIBILITY_HELP: Labels<typeof VISIBILITY_VALUES> = {
  public: 'Pode aparecer em currículos gerados.',
  private: 'Fica só para você: nunca vai a currículos nem a documentos.',
  conditional: 'Só aparece com a sua autorização, caso a caso.',
};

export const RESUME_USE_LABELS: Labels<typeof RESUME_USE_VALUES> = {
  allowed: 'Pode usar',
  requires_approval: 'Usar só com aprovação',
  never: 'Nunca usar',
};

export const RESUME_USE_HELP: Labels<typeof RESUME_USE_VALUES> = {
  allowed: 'Pode ser usado em currículos quando for relevante.',
  requires_approval: 'Só entra em um currículo depois de você aprovar.',
  never: 'Não entra em nenhum currículo.',
};

export const FIELD_STATE_LABELS: Labels<typeof FIELD_STATE_VALUES> = {
  not_provided: 'Não informado',
  not_applicable: 'Não se aplica',
  not_assessed: 'Ainda não avaliado',
  declined: 'Prefiro não informar',
  needs_confirmation: 'Preciso confirmar',
};

export const FIELD_STATE_HELP: Labels<typeof FIELD_STATE_VALUES> = {
  not_provided: 'Nada foi dito sobre este campo.',
  not_applicable: 'Este campo não faz sentido para este item. Não voltaremos a perguntar.',
  not_assessed: 'Você ainda não avaliou este campo.',
  declined: 'Você escolheu não informar. Não voltaremos a perguntar.',
  needs_confirmation: 'Há um valor, mas ele ainda precisa ser conferido antes de ser afirmado.',
};

export const USAGE_CONTEXT_LABELS: Labels<typeof USAGE_CONTEXT_VALUES> = {
  professional_experience: 'Experiência profissional',
  project_experience: 'Projeto',
  volunteer_experience: 'Voluntariado',
  coursework: 'Curso ou formação',
  certification: 'Certificação',
  self_declared_knowledge: 'Conhecimento declarado',
  conceptual_familiarity: 'Familiaridade conceitual',
  unverified: 'Sem contexto verificado',
};

export const USAGE_CONTEXT_HELP: Labels<typeof USAGE_CONTEXT_VALUES> = {
  professional_experience: 'Usei isso em um trabalho, emprego ou atividade profissional.',
  project_experience: 'Usei isso em um projeto (pessoal, acadêmico, aberto, etc.).',
  volunteer_experience: 'Usei isso em uma atividade voluntária ou comunitária.',
  coursework: 'Estudei isso em um curso ou formação, sem uso profissional.',
  certification: 'Tenho uma certificação que comprova isso.',
  self_declared_knowledge: 'Eu sei isso, mas não vou apontar onde usei.',
  conceptual_familiarity: 'Conheço a ideia, mas não tenho prática.',
  unverified: 'Ainda não sei dizer onde usei. Fica marcado para você completar depois.',
};

export const EMPLOYMENT_TYPE_LABELS: Labels<typeof EMPLOYMENT_TYPE_VALUES> = {
  employee: 'Empregado(a)',
  internship: 'Estágio',
  apprenticeship: 'Aprendiz',
  contractor: 'Prestador(a) de serviço (PJ)',
  freelance: 'Freelancer',
  self_employed: 'Autônomo(a)',
  business_owner: 'Dono(a) de negócio',
  temporary: 'Temporário',
  public_service: 'Serviço público',
  volunteer: 'Voluntário(a)',
  other: 'Outro',
};

export const WORK_MODE_LABELS: Labels<typeof WORK_MODE_VALUES> = {
  onsite: 'Presencial',
  hybrid: 'Híbrido',
  remote: 'Remoto',
};

export const PROJECT_CATEGORY_LABELS: Labels<typeof PROJECT_CATEGORY_VALUES> = {
  personal: 'Pessoal',
  academic: 'Acadêmico',
  open_source: 'Código aberto',
  freelance: 'Freelance',
  professional: 'Profissional',
  research: 'Pesquisa',
  volunteer: 'Voluntário',
  entrepreneurial: 'Empreendedor',
  other: 'Outro',
};

export const PROJECT_STATUS_LABELS: Labels<typeof PROJECT_STATUS_VALUES> = {
  idea: 'Ideia',
  in_progress: 'Em andamento',
  active: 'Ativo',
  completed: 'Concluído',
  archived: 'Encerrado',
};

export const PUBLIC_ACCESS_LABELS: Labels<typeof PUBLIC_ACCESS_VALUES> = {
  public: 'Público',
  partial: 'Parcialmente público',
  not_public: 'Não público',
};

export const SELF_LEVEL_LABELS: Labels<typeof SELF_ASSESSED_LEVEL_VALUES> = {
  not_assessed: 'Ainda não avaliei',
  exposure: 'Contato inicial',
  basic: 'Básico',
  intermediate: 'Intermediário',
  advanced: 'Avançado',
  expert: 'Especialista',
};

export const LANGUAGE_LEVEL_LABELS: Labels<typeof LANGUAGE_LEVEL_VALUES> = {
  A1: 'A1 (iniciante)',
  A2: 'A2 (básico)',
  B1: 'B1 (intermediário)',
  B2: 'B2 (intermediário superior)',
  C1: 'C1 (avançado)',
  C2: 'C2 (proficiente)',
  native: 'Nativo',
  not_assessed: 'Ainda não avaliei',
};

export const SENIORITY_LABELS: Labels<typeof SENIORITY_VALUES> = {
  student: 'Estudante',
  entry: 'Início de carreira',
  junior: 'Júnior',
  mid: 'Pleno',
  senior: 'Sênior',
  specialist: 'Especialista',
  lead: 'Liderança técnica',
  manager: 'Gestão',
  executive: 'Executivo(a)',
  not_assessed: 'Ainda não avaliei',
};

export const PENDING_REASON_LABELS: Labels<typeof PENDING_REASON_VALUES> = {
  missing: 'Informação faltando',
  conflict: 'Informações em conflito',
  stale: 'Pode estar desatualizado',
  unclear: 'Pouco claro',
};

export const PENDING_STATUS_LABELS: Labels<typeof PENDING_STATUS_VALUES> = {
  open: 'Aberta',
  resolved: 'Resolvida',
  dismissed: 'Dispensada',
};

export const PRIORITY_LABELS: Labels<typeof PRIORITY_VALUES> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

export const EVIDENCE_TYPE_LABELS: Labels<typeof EVIDENCE_TYPE_VALUES> = {
  repository: 'Repositório',
  certificate: 'Certificado',
  portfolio: 'Portfólio',
  document: 'Documento',
  publication: 'Publicação',
  demo: 'Demonstração',
  reference: 'Referência de terceiros',
  self_declaration: 'Autodeclaração',
  other: 'Outro',
};

export const RECRUITER_SHARING_LABELS: Labels<typeof RECRUITER_SHARING_VALUES> = {
  allowed: 'Pode compartilhar',
  restricted: 'Compartilhar com restrições',
  not_allowed: 'Não compartilhar',
};

export const EDUCATION_STATUS_LABELS: Labels<typeof EDUCATION_STATUS_VALUES> = {
  completed: 'Concluída',
  in_progress: 'Em andamento',
  suspended: 'Trancada',
  incomplete: 'Incompleta',
};

export const DEGREE_TYPE_LABELS: Labels<typeof DEGREE_TYPE_VALUES> = {
  secondary: 'Ensino médio',
  technical: 'Técnico',
  associate: 'Tecnólogo',
  bachelor: 'Graduação',
  specialization: 'Especialização',
  mba: 'MBA',
  masters: 'Mestrado',
  doctorate: 'Doutorado',
  postdoc: 'Pós-doutorado',
  other: 'Outro',
};

export const STUDY_MODALITY_LABELS: Labels<typeof STUDY_MODALITY_VALUES> = {
  onsite: 'Presencial',
  online: 'Online',
  hybrid: 'Híbrido',
};

export const COURSE_STATUS_LABELS: Labels<typeof COURSE_STATUS_VALUES> = {
  completed: 'Concluído',
  in_progress: 'Em andamento',
  incomplete: 'Incompleto',
};

export const SKILL_CATEGORY_LABELS: Labels<typeof SKILL_CATEGORY_VALUES> = {
  language: 'Linguagem',
  framework: 'Framework',
  library: 'Biblioteca',
  database: 'Banco de dados',
  tool: 'Ferramenta',
  method: 'Método',
  domain: 'Área de conhecimento',
  soft_skill: 'Competência comportamental',
  spoken_language: 'Idioma falado',
  other: 'Outra',
};

export const CERTIFICATION_CATEGORY_LABELS: Labels<typeof CERTIFICATION_CATEGORY_VALUES> = {
  professional_certification: 'Certificação profissional',
  license: 'Licença',
  credential: 'Credencial',
  attendance: 'Participação',
  completion: 'Conclusão',
  other: 'Outra',
};

export const CERTIFICATION_STATUS_LABELS: Labels<typeof CERTIFICATION_STATUS_VALUES> = {
  valid: 'Válida',
  expired: 'Expirada',
  renewal_in_progress: 'Renovação em andamento',
  no_expiration: 'Sem validade',
};

export const AWARD_SCOPE_LABELS: Labels<typeof AWARD_SCOPE_VALUES> = {
  institutional: 'Institucional',
  regional: 'Regional',
  national: 'Nacional',
  international: 'Internacional',
  other: 'Outro',
};

export const PUBLICATION_TYPE_LABELS: Labels<typeof PUBLICATION_TYPE_VALUES> = {
  article: 'Artigo',
  research: 'Pesquisa',
  thesis: 'Tese',
  dissertation: 'Dissertação',
  talk: 'Palestra',
  lecture: 'Aula',
  book: 'Livro',
  chapter: 'Capítulo',
  documentation: 'Documentação',
  other: 'Outro',
};

export const PUBLICATION_STATUS_LABELS: Labels<typeof PUBLICATION_STATUS_VALUES> = {
  published: 'Publicado',
  presented: 'Apresentado',
  submitted: 'Submetido',
  in_progress: 'Em andamento',
};

export const PARTICIPATION_TYPE_LABELS: Labels<typeof PARTICIPATION_TYPE_VALUES> = {
  volunteer: 'Voluntariado',
  community: 'Comunidade',
  association: 'Associação',
  leadership: 'Liderança',
  mentoring: 'Mentoria',
  student_activity: 'Atividade estudantil',
  other: 'Outro',
};

export const CONTACT_KIND_LABELS: Labels<typeof CONTACT_KIND_VALUES> = {
  email: 'E-mail',
  phone: 'Telefone',
  link: 'Link',
};

export const CONTACT_SUBTYPE_LABELS: Labels<typeof CONTACT_SUBTYPE_VALUES> = {
  professional: 'Profissional',
  personal: 'Pessoal',
  mobile: 'Celular',
  landline: 'Fixo',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
  portfolio: 'Portfólio',
  website: 'Site',
  behance: 'Behance',
  dribbble: 'Dribbble',
  artstation: 'ArtStation',
  other: 'Outro',
};

/** Subtipos permitidos por tipo de contato (espelha a regra do contrato). */
export const CONTACT_SUBTYPES_BY_KIND: Record<
  (typeof CONTACT_KIND_VALUES)[number],
  readonly (typeof CONTACT_SUBTYPE_VALUES)[number][]
> = {
  email: ['professional', 'personal', 'other'],
  phone: ['professional', 'personal', 'mobile', 'landline', 'whatsapp', 'other'],
  link: [
    'linkedin',
    'github',
    'gitlab',
    'bitbucket',
    'portfolio',
    'website',
    'behance',
    'dribbble',
    'artstation',
    'professional',
    'personal',
    'other',
  ],
};

export const STATEMENT_KIND_LABELS: Labels<typeof STATEMENT_KIND_VALUES> = {
  one_sentence_intro: 'Apresentação em uma frase',
  short_summary: 'Resumo curto',
  full_summary: 'Resumo completo',
  career_narrative: 'Narrativa de carreira',
  differentiator: 'Diferencial',
  value: 'Valor ou princípio',
};

export const EXPERIENCE_ITEM_KIND_LABELS: Labels<typeof EXPERIENCE_ITEM_KIND_VALUES> = {
  responsibility: 'Responsabilidade',
  achievement: 'Conquista',
  delivery: 'Entrega',
};

export const PROJECT_ITEM_KIND_LABELS: Labels<typeof PROJECT_ITEM_KIND_VALUES> = {
  feature: 'Funcionalidade',
  contribution: 'Contribuição',
  deliverable: 'Entrega',
  outcome: 'Resultado',
  metric: 'Métrica',
  business_rule: 'Regra de negócio',
  workflow: 'Fluxo de trabalho',
  decision: 'Decisão',
  test: 'Teste',
  integration: 'Integração',
};

export const FREQUENCY_LABELS: Labels<typeof FREQUENCY_VALUES> = {
  daily: 'Diária',
  weekly: 'Semanal',
  occasional: 'Ocasional',
  project_based: 'Por projeto',
};

export const AUTONOMY_LABELS: Labels<typeof AUTONOMY_VALUES> = {
  supervised: 'Com supervisão',
  partial: 'Parcial',
  independent: 'Independente',
  not_assessed: 'Ainda não avaliei',
};

export const TRI_STATE_LABELS: Labels<typeof TRI_STATE_VALUES> = {
  yes: 'Sim',
  no: 'Não',
  depends: 'Depende',
};

export const REFERENCE_PERMISSION_LABELS: Labels<typeof REFERENCE_PERMISSION_VALUES> = {
  allowed: 'Pode contatar',
  not_allowed: 'Não contatar',
  ask_first: 'Perguntar antes',
};

export const SALARY_PERIOD_LABELS: Labels<typeof SALARY_PERIOD_VALUES> = {
  hourly: 'Por hora',
  monthly: 'Por mês',
  yearly: 'Por ano',
};

export const TONE_LABELS: Labels<typeof TONE_VALUES> = {
  formal: 'Formal',
  professional_direct: 'Profissional e direto',
  technical: 'Técnico',
  executive: 'Executivo',
  academic: 'Acadêmico',
  other: 'Outro',
};

export const PREFERRED_LENGTH_LABELS: Labels<typeof PREFERRED_LENGTH_VALUES> = {
  one_page: 'Uma página',
  two_pages: 'Duas páginas',
  content_based: 'Conforme o conteúdo',
};

export const OUTPUT_FORMAT_LABELS: Labels<typeof OUTPUT_FORMAT_VALUES> = {
  docx: 'DOCX',
  pdf: 'PDF',
};

export const VISUAL_STYLE_LABELS: Labels<typeof VISUAL_STYLE_VALUES> = {
  ats_simple: 'Simples (compatível com ATS)',
  traditional: 'Tradicional',
  modern_discreet: 'Moderno e discreto',
  academic: 'Acadêmico',
  portfolio: 'Portfólio',
};

export const PHOTO_PREFERENCE_LABELS: Labels<typeof PHOTO_PREFERENCE_VALUES> = {
  never: 'Nunca incluir foto',
  when_appropriate: 'Incluir quando apropriado',
};

export const RESUME_SECTION_LABELS: Labels<typeof RESUME_SECTION_VALUES> = {
  summary: 'Resumo',
  experience: 'Experiência',
  projects: 'Projetos',
  education: 'Formação',
  courses: 'Cursos',
  skills: 'Competências',
  languages: 'Idiomas',
  certifications: 'Certificações',
  awards: 'Prêmios',
  publications: 'Publicações',
  volunteering: 'Voluntariado',
};

export const RESTRICTION_RULE_LABELS: Labels<typeof RESTRICTION_RULE_VALUES> = {
  never_include: 'Nunca incluir',
  require_approval: 'Exigir minha aprovação',
  private_guidance_only: 'Usar só como orientação privada',
};

export const REVIEWED_BY_LABELS: Labels<typeof REVIEWED_BY_VALUES> = {
  self: 'Eu mesmo(a)',
  other_authorized: 'Outra pessoa autorizada',
};

/** Nome singular de cada tipo de registro, para mensagens e vinculos. */
export const RECORD_KIND_LABELS: Labels<typeof RECORD_KIND_VALUES> = {
  contact_point: 'Contato',
  statement: 'Declaração',
  competency_example: 'Exemplo de competência',
  experience: 'Experiência',
  experience_item: 'Item de experiência',
  project: 'Projeto',
  project_item: 'Item de projeto',
  collaborator: 'Colaborador(a)',
  education: 'Formação',
  course: 'Curso',
  skill: 'Competência',
  skill_usage: 'Uso de competência',
  language: 'Idioma',
  certification: 'Certificação',
  award: 'Prêmio',
  publication: 'Publicação',
  volunteering: 'Voluntariado',
  evidence: 'Evidência',
  pending_item: 'Pendência',
  restriction: 'Restrição',
};
