/**
 * Especificacao declarativa do mapeamento contrato (snake_case, plano) <-> colunas (camelCase).
 *
 * Regra: o que a spec nao lista como coluna nem como "especial" vai para `details` JSONB com a chave
 * do contrato (so atributos descritivos, ADR-0006 item 3). Assim, um campo novo do contrato nunca e
 * perdido em silencio: sem spec, vai para `details` (e o round-trip continua exato).
 */

export type ScalarType = 'text' | 'enum' | 'bool' | 'float' | 'ref';

export interface ScalarSpec {
  /** Chave do contrato; `a.b` = campo do objeto aninhado `a` (ex.: `location.city`). */
  key: string;
  /** Coluna no banco. */
  prop: string;
  type: ScalarType;
}

export interface DateSpec {
  /** Chave do contrato (data parcial AAAA[-MM[-DD]] ou, em fim de periodo, `present`). */
  key: string;
  dateProp: string;
  precisionProp: string;
  /** Fim de periodo: aceita `present` (coluna booleana `isCurrent`). */
  currentProp?: string;
}

export type DelegateName =
  | 'professionalProfile'
  | 'profileFact'
  | 'profileStatement'
  | 'competencyExample'
  | 'competencyExampleSkill'
  | 'experience'
  | 'experienceItem'
  | 'project'
  | 'projectItem'
  | 'projectCollaborator'
  | 'education'
  | 'course'
  | 'skill'
  | 'skillUsage'
  | 'languageProficiency'
  | 'certification'
  | 'award'
  | 'publication'
  | 'volunteering'
  | 'contactPoint'
  | 'evidence'
  | 'evidenceLink'
  | 'pendingItem'
  | 'usageRestriction';

export type FactKindName =
  | 'statement'
  | 'competency_example'
  | 'experience'
  | 'experience_item'
  | 'project'
  | 'project_item'
  | 'education'
  | 'course'
  | 'skill'
  | 'skill_usage'
  | 'language'
  | 'certification'
  | 'award'
  | 'publication'
  | 'volunteering';

export interface FactSpec {
  kind: FactKindName;
  delegate: DelegateName;
  scalars: readonly ScalarSpec[];
  dates: readonly DateSpec[];
  /** Chaves do contrato tratadas por codigo dedicado (filhos, vinculos); nao vao para `details`. */
  special: readonly string[];
}

const t = (key: string, prop: string): ScalarSpec => ({ key, prop, type: 'text' });
const en = (key: string, prop: string): ScalarSpec => ({ key, prop, type: 'enum' });
const bo = (key: string, prop: string): ScalarSpec => ({ key, prop, type: 'bool' });
const ref = (key: string, prop: string): ScalarSpec => ({ key, prop, type: 'ref' });

const start = (): DateSpec => ({
  key: 'start_date',
  dateProp: 'startDate',
  precisionProp: 'startPrecision',
});
const end = (): DateSpec => ({
  key: 'end_date',
  dateProp: 'endDate',
  precisionProp: 'endPrecision',
  currentProp: 'isCurrent',
});
const completion = (): DateSpec => ({
  key: 'completion_date',
  dateProp: 'completionDate',
  precisionProp: 'completionPrecision',
});

export const FACT_SPECS: readonly FactSpec[] = [
  {
    kind: 'statement',
    delegate: 'profileStatement',
    scalars: [en('kind', 'kind'), t('text', 'text'), t('locale', 'locale')],
    dates: [],
    special: [],
  },
  {
    kind: 'competency_example',
    delegate: 'competencyExample',
    scalars: [t('competency', 'competency')],
    dates: [],
    special: ['related_skill_ids'],
  },
  {
    kind: 'experience',
    delegate: 'experience',
    scalars: [
      t('organization_name', 'organizationName'),
      t('organization_public_name', 'organizationPublicName'),
      t('organization_group', 'organizationGroup'),
      t('industry', 'industry'),
      t('location.city', 'city'),
      t('location.region', 'region'),
      t('location.country', 'country'),
      t('official_title', 'officialTitle'),
      t('display_title', 'displayTitle'),
      en('employment_type', 'employmentType'),
      en('work_mode', 'workMode'),
    ],
    dates: [start(), end()],
    special: ['items'],
  },
  {
    kind: 'experience_item',
    delegate: 'experienceItem',
    scalars: [en('kind', 'kind'), t('text', 'text')],
    dates: [],
    special: [],
  },
  {
    kind: 'project',
    delegate: 'project',
    scalars: [
      t('name', 'name'),
      en('category', 'category'),
      bo('team_based', 'teamBased'),
      en('status', 'status'),
      t('role', 'role'),
      en('public_access', 'publicAccess'),
      t('license', 'license'),
      t('public_url', 'publicUrl'),
      t('repository_url', 'repositoryUrl'),
      t('documentation_url', 'documentationUrl'),
      t('demo_url', 'demoUrl'),
      ref('related_experience_id', 'relatedExperienceId'),
      ref('related_education_id', 'relatedEducationId'),
    ],
    dates: [start(), end()],
    special: ['items', 'collaborators'],
  },
  {
    kind: 'project_item',
    delegate: 'projectItem',
    scalars: [en('kind', 'kind'), t('text', 'text')],
    dates: [],
    special: [],
  },
  {
    kind: 'education',
    delegate: 'education',
    scalars: [
      t('institution', 'institution'),
      t('course_name', 'courseName'),
      en('degree_type', 'degreeType'),
      t('field_of_study', 'fieldOfStudy'),
      en('status', 'status'),
      en('modality', 'modality'),
      t('location', 'location'),
      t('qualification_awarded', 'qualificationAwarded'),
    ],
    dates: [
      start(),
      completion(),
      {
        key: 'expected_completion_date',
        dateProp: 'expectedCompletionDate',
        precisionProp: 'expectedCompletionPrecision',
      },
    ],
    special: [],
  },
  {
    kind: 'course',
    delegate: 'course',
    scalars: [
      t('name', 'name'),
      t('provider', 'provider'),
      en('status', 'status'),
      { key: 'workload_hours', prop: 'workloadHours', type: 'float' },
      bo('certificate_issued', 'certificateIssued'),
    ],
    dates: [start(), completion()],
    special: [],
  },
  {
    kind: 'skill',
    delegate: 'skill',
    scalars: [
      t('name', 'name'),
      en('category', 'category'),
      en('self_assessed_level', 'selfAssessedLevel'),
    ],
    dates: [],
    special: [],
  },
  {
    kind: 'skill_usage',
    delegate: 'skillUsage',
    scalars: [
      ref('skill_id', 'skillId'),
      en('usage_context', 'usageContext'),
      ref('experience_id', 'experienceId'),
      ref('project_id', 'projectId'),
      ref('education_id', 'educationId'),
      ref('course_id', 'courseId'),
      ref('certification_id', 'certificationId'),
      ref('volunteering_id', 'volunteeringId'),
      t('facet', 'facet'),
      en('level_in_context', 'levelInContext'),
    ],
    dates: [start(), end()],
    special: [],
  },
  {
    kind: 'language',
    delegate: 'languageProficiency',
    scalars: [
      t('language', 'languageLabel'),
      t('language_code', 'languageCode'),
      en('overall_level', 'overallLevel'),
      t('self_described_level', 'selfDescribedLevel'),
      en('reading', 'reading'),
      en('writing', 'writing'),
      en('listening', 'listening'),
      en('speaking', 'speaking'),
      ref('certification_id', 'certificationId'),
    ],
    dates: [],
    special: [],
  },
  {
    kind: 'certification',
    delegate: 'certification',
    scalars: [
      t('name', 'name'),
      t('issuer', 'issuer'),
      en('category', 'category'),
      en('status', 'status'),
      t('public_identifier', 'publicIdentifier'),
      t('verification_url', 'verificationUrl'),
    ],
    dates: [
      { key: 'issue_date', dateProp: 'issueDate', precisionProp: 'issuePrecision' },
      { key: 'expiration_date', dateProp: 'expirationDate', precisionProp: 'expirationPrecision' },
    ],
    special: [],
  },
  {
    kind: 'award',
    delegate: 'award',
    scalars: [t('name', 'name'), t('organization', 'organization'), en('scope', 'scope')],
    dates: [{ key: 'date', dateProp: 'date', precisionProp: 'datePrecision' }],
    special: [],
  },
  {
    kind: 'publication',
    delegate: 'publication',
    scalars: [
      t('title', 'title'),
      en('type', 'type'),
      en('status', 'status'),
      t('venue_or_institution', 'venueOrInstitution'),
      t('url', 'url'),
      t('doi', 'doi'),
    ],
    dates: [{ key: 'date', dateProp: 'date', precisionProp: 'datePrecision' }],
    special: [],
  },
  {
    kind: 'volunteering',
    delegate: 'volunteering',
    scalars: [
      t('organization', 'organization'),
      t('role', 'role'),
      en('participation_type', 'participationType'),
    ],
    dates: [start(), end()],
    special: [],
  },
];

export const FACT_SPEC_BY_KIND: ReadonlyMap<FactKindName, FactSpec> = new Map(
  FACT_SPECS.map((spec) => [spec.kind, spec]),
);

export interface PlainSpec {
  delegate: DelegateName;
  scalars: readonly ScalarSpec[];
  dates: readonly DateSpec[];
  special: readonly string[];
}

/** Registros nao citaveis (sem `meta`): contatos, evidencias, colaboradores. */
export const CONTACT_SPEC: PlainSpec = {
  delegate: 'contactPoint',
  scalars: [
    en('kind', 'kind'),
    en('subtype', 'subtype'),
    t('value', 'value'),
    t('label', 'label'),
    en('visibility', 'visibility'),
    bo('include_by_default', 'includeByDefault'),
    bo('is_primary', 'isPrimary'),
    t('notes', 'notes'),
  ],
  dates: [],
  special: [],
};

export const EVIDENCE_SPEC: PlainSpec = {
  delegate: 'evidence',
  scalars: [
    en('type', 'type'),
    t('title', 'title'),
    t('url_or_location', 'urlOrLocation'),
    bo('is_public', 'isPublic'),
    en('recruiter_sharing', 'recruiterSharing'),
    t('notes', 'notes'),
  ],
  dates: [
    { key: 'evidence_date', dateProp: 'evidenceDate', precisionProp: 'evidenceDatePrecision' },
  ],
  special: ['supports'],
};

export const COLLABORATOR_SPEC: PlainSpec = {
  delegate: 'projectCollaborator',
  scalars: [t('name_or_role', 'nameOrRole'), t('contribution', 'contribution')],
  dates: [],
  special: [],
};

/** Colunas Json por tabela (null precisa virar `Prisma.DbNull` na escrita). */
export const JSON_COLUMNS: Readonly<Record<DelegateName, readonly string[]>> = {
  professionalProfile: [
    'identity',
    'positioning',
    'availabilityPreferences',
    'careerPreferences',
    'resumePreferences',
    'additionalContext',
    'usageRules',
    'review',
  ],
  profileFact: ['fieldStates'],
  profileStatement: [],
  competencyExample: ['details'],
  competencyExampleSkill: [],
  experience: ['details'],
  experienceItem: ['details'],
  project: ['details'],
  projectItem: ['details'],
  projectCollaborator: [],
  education: ['details'],
  course: ['details'],
  skill: ['details'],
  skillUsage: ['details'],
  languageProficiency: ['details'],
  certification: [],
  award: ['details'],
  publication: ['details'],
  volunteering: ['details'],
  contactPoint: [],
  evidence: ['details'],
  evidenceLink: [],
  pendingItem: ['details'],
  usageRestriction: [],
};

/** Chaves de `meta` (contrato) na ordem usada em `metaKeys`. */
export const META_KEYS = [
  'status',
  'declared_status',
  'visibility',
  'resume_use',
  'source',
  'source_detail',
  'source_excerpt',
  'evidence_ids',
  'field_states',
  'private_notes',
] as const;
