import { z } from 'zod';

/**
 * Contrato LEGADO 1.0.0 (somente leitura, para migracao v1 -> v2; ADR-0004).
 *
 * Reflete `PERFIL_PROFISSIONAL_SCHEMA.json` 1.0.0, mas e TOLERANTE onde o schema original era
 * inconsistente com o proprio cabecalho do YAML ("use null quando desconhecido"): qualquer valor
 * escalar aceita `null`. Objetos sao abertos (`looseObject`), como `additionalProperties: true`
 * no original: chaves desconhecidas sao preservadas e tratadas pela migracao (nunca descartadas
 * em silencio). Enums de 1.0.0 nao sao impostos aqui: a migracao os valida e reporta.
 * Nao use este schema para novos documentos.
 */

export const LEGACY_SCHEMA_VERSION = '1.0.0' as const;

const str = z.string().nullish();
const bool = z.boolean().nullish();
const num = z.number().nullish();
const strs = z.array(z.string()).nullish();
const objs = <T extends z.ZodRawShape>(shape: T) => z.array(z.looseObject(shape)).nullish();

const evidenceIds = strs;

const responsibility = {
  description: str,
  frequency: str,
  autonomy: str,
  tools: strs,
  outcome: str,
};
const achievement = {
  description: str,
  metric_name: str,
  metric_value: str,
  baseline: str,
  period: str,
  calculation_method: str,
  personal_contribution: str,
  evidence_ids: evidenceIds,
  public_disclosure: str,
};
const internalDelivery = {
  name: str,
  problem: str,
  personal_contribution: str,
  collaborators: strs,
  steps: strs,
  technologies: strs,
  outcome: str,
  verification: str,
  disclosure: str,
};
const technologyUsed = {
  name: str,
  usage_context: str,
  tasks: strs,
  usage_period: str,
  self_assessed_level: str,
};

const experience = {
  id: str,
  organization: str,
  organization_public_name: str,
  industry: str,
  location: z.looseObject({ city: str, region: str, country: str }).nullish(),
  official_title: str,
  resume_display_title: str,
  employment_type: str,
  department: str,
  start_date: str,
  end_date: str,
  is_current: bool,
  work_mode: str,
  company_context: str,
  role_objective: str,
  products_services_users: str,
  operational_scope: str,
  team_interfaces: strs,
  responsibilities: objs(responsibility),
  achievements: objs(achievement),
  internal_deliveries: objs(internalDelivery),
  technologies_used: objs(technologyUsed),
  transferable_skills: strs,
  lessons_learned: strs,
  exit_reason_private: str,
  reference_contact_permission: str,
  fact_status: str,
  evidence_ids: evidenceIds,
  notes: str,
};

const project = {
  id: str,
  name: str,
  category: str,
  status: str,
  start_date: str,
  end_date: str,
  last_updated: str,
  role: str,
  team_based: bool,
  collaborators: objs({ name_or_role: str, contribution: str }),
  personal_contribution: str,
  contributions_by_others: str,
  decision_ownership: str,
  problem: str,
  target_audience: str,
  need_addressed: str,
  proposed_solution: str,
  main_features: strs,
  workflows: strs,
  business_rules: strs,
  constraints_and_decisions: strs,
  architecture: str,
  frontend: strs,
  backend: strs,
  databases: strs,
  apis_and_integrations: strs,
  authentication_authorization: str,
  infrastructure_deployment: strs,
  testing_quality: strs,
  security_privacy: strs,
  observability: strs,
  documentation: strs,
  methods_and_version_control: strs,
  technologies: objs({
    name: str,
    usage: str,
    personal_implementation: str,
    context: str,
    self_assessed_level: str,
  }),
  deliverables: strs,
  outcomes: strs,
  metrics: objs({ name: str, value: str, method: str, evidence_ids: evidenceIds, disclosure: str }),
  tests_performed: strs,
  feedback: strs,
  known_limitations: strs,
  next_improvements: strs,
  learning: strs,
  public_url: str,
  repository_url: str,
  documentation_url: str,
  demo_url: str,
  license: str,
  is_public: bool,
  disclosure: str,
  one_line_description: str,
  short_description: str,
  resume_keywords: strs,
  evidence_ids: evidenceIds,
  fact_status: str,
  notes: str,
};

const education = {
  id: str,
  institution: str,
  course_name: str,
  degree_type: str,
  field_of_study: str,
  status: str,
  start_date: str,
  completion_date: str,
  expected_completion_date: str,
  modality: str,
  location: str,
  qualification_awarded: str,
  thesis_title: str,
  thesis_description: str,
  supervisor: str,
  relevant_coursework: strs,
  academic_projects: strs,
  honors_scholarships_distinctions: strs,
  verification_url: str,
  evidence_ids: evidenceIds,
  fact_status: str,
  notes: str,
};

const course = {
  id: str,
  name: str,
  provider: str,
  topics: strs,
  start_date: str,
  completion_date: str,
  workload_hours: num,
  status: str,
  certificate_issued: bool,
  verification_url: str,
  main_topics: strs,
  activities_projects: strs,
  skills_developed: strs,
  relevant_job_families: strs,
  evidence_ids: evidenceIds,
};

const skill = {
  id: str,
  name: str,
  category: str,
  description: str,
  self_assessed_level: str,
  acquisition_contexts: strs,
  related_experience_ids: strs,
  related_project_ids: strs,
  related_education_ids: strs,
  tasks_can_perform: strs,
  last_used: str,
  duration_of_use: str,
  evidence_ids: evidenceIds,
  resume_usage: str,
  limitations: str,
  fact_status: str,
};

const developingKnowledge = {
  topic: str,
  study_scope: str,
  learning_sources: strs,
  practical_project: str,
  perceived_level: str,
  next_goal: str,
};

const language = {
  language: str,
  overall_level: str,
  reading: str,
  writing: str,
  listening: str,
  speaking: str,
  professional_usage: str,
  certification_name: str,
  certification_score: str,
  assessment_date: str,
  include_in_resume: str,
  evidence_ids: evidenceIds,
};

const certification = {
  id: str,
  name: str,
  issuer: str,
  category: str,
  issue_date: str,
  expiration_date: str,
  public_identifier: str,
  verification_url: str,
  related_skills: strs,
  status: str,
  evidence_ids: evidenceIds,
};

const award = {
  name: str,
  organization: str,
  date: str,
  context_and_criteria: str,
  personal_contribution: str,
  scope: str,
  evidence_ids: evidenceIds,
  disclosure: str,
};

const publication = {
  title: str,
  type: str,
  date: str,
  venue_or_institution: str,
  authorship: str,
  summary: str,
  personal_contribution: str,
  topics_methods: strs,
  url_or_doi: str,
  status: str,
  evidence_ids: evidenceIds,
};

const volunteering = {
  organization: str,
  role: str,
  participation_type: str,
  start_date: str,
  end_date: str,
  responsibilities: strs,
  audience: str,
  outcomes: strs,
  skills_demonstrated: strs,
  evidence_ids: evidenceIds,
  disclosure: str,
};

const freelance = {
  business_or_professional_name: str,
  activity: str,
  start_date: str,
  end_date: str,
  client_market_description: str,
  services_scope: strs,
  personal_responsibilities: strs,
  tools_technologies: strs,
  deliveries: strs,
  verifiable_results: strs,
  project_or_client_count: z.number().int().nullish(),
  portfolio_url: str,
  client_names_disclosure: str,
  evidence_ids: evidenceIds,
};

const evidence = {
  id: str,
  type: str,
  title: str,
  url_or_location: str,
  supported_claims: strs,
  evidence_date: str,
  is_public: bool,
  approved_for_recruiter_sharing: bool,
  notes: str,
};

const pendingItem = {
  id: str,
  subject: str,
  current_information: str,
  uncertainty_reason: str,
  known_variants: strs,
  safe_statement_for_now: str,
  confirmation_method: str,
  priority: str,
  status: str,
};

export const legacyProfileV1Schema = z.strictObject({
  schema_version: z.literal(LEGACY_SCHEMA_VERSION),
  locale: str,
  profile: z.looseObject({
    identity: z
      .looseObject({
        full_name: str,
        preferred_name: str,
        pronunciation: str,
        pronouns: str,
        country_of_residence: str,
        city: str,
        region: str,
        country_of_work_interest: strs,
        timezone: str,
        interface_languages: strs,
      })
      .nullish(),
    contact: z
      .looseObject({
        professional_email: str,
        phone: str,
        links: objs({
          type: str,
          label: str,
          url: str,
          visibility: str,
          include_by_default: bool,
          notes: str,
        }),
      })
      .nullish(),
    positioning: z
      .looseObject({
        current_profession: str,
        current_job_title: str,
        current_seniority: str,
        professional_headline: str,
        one_sentence_intro: str,
        short_summary: str,
        full_summary: str,
        career_narrative: str,
        primary_fields: strs,
        secondary_fields: strs,
        preferred_job_titles: strs,
        excluded_job_titles: strs,
        industries_of_interest: strs,
        industries_to_avoid: strs,
        professional_interests: strs,
        preferred_problems_to_solve: strs,
        short_term_goals: str,
        long_term_goals: str,
        demonstrable_differentiators: strs,
        professional_values: strs,
      })
      .nullish(),
    competency_examples: objs({
      competency: str,
      situation: str,
      action: str,
      outcome_or_learning: str,
      evidence_ids: evidenceIds,
    }),
    experiences: objs(experience),
    projects: objs(project),
    education: objs(education),
    courses: objs(course),
    skills: objs(skill),
    developing_knowledge: objs(developingKnowledge),
    languages: objs(language),
    certifications: objs(certification),
    awards: objs(award),
    publications_research_talks: objs(publication),
    volunteering_and_leadership: objs(volunteering),
    freelance_and_business: objs(freelance),
    availability_preferences: z.looseObject({}).nullish(),
    career_preferences: z.looseObject({}).nullish(),
    resume_preferences: z.looseObject({}).nullish(),
    additional_professional_context: z.looseObject({}).nullish(),
    evidence_registry: objs(evidence),
    pending_items: objs(pendingItem),
    usage_rules: z.looseObject({}).nullish(),
    review: z.looseObject({}).nullish(),
  }),
});

/** Chaves conhecidas por tipo de objeto do 1.0.0 (a migracao reporta o que estiver fora delas). */
export const LEGACY_V1_SHAPES = {
  responsibility,
  achievement,
  internal_delivery: internalDelivery,
  technology_used: technologyUsed,
  experience,
  project,
  education,
  course,
  skill,
  developing_knowledge: developingKnowledge,
  language,
  certification,
  award,
  publication,
  volunteering,
  freelance,
  evidence,
  pending_item: pendingItem,
} as const;

export type LegacyProfileV1 = z.infer<typeof legacyProfileV1Schema>;
