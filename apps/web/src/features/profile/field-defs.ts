import {
  AUTONOMY_VALUES,
  AWARD_SCOPE_VALUES,
  CERTIFICATION_CATEGORY_VALUES,
  CERTIFICATION_STATUS_VALUES,
  CONTACT_KIND_VALUES,
  COURSE_STATUS_VALUES,
  DEGREE_TYPE_VALUES,
  EDUCATION_STATUS_VALUES,
  EMPLOYMENT_TYPE_VALUES,
  EVIDENCE_TYPE_VALUES,
  EXPERIENCE_ITEM_KIND_VALUES,
  FREQUENCY_VALUES,
  IDENTITY_VISIBILITY_FIELDS,
  LANGUAGE_LEVEL_VALUES,
  OUTPUT_FORMAT_VALUES,
  PARTICIPATION_TYPE_VALUES,
  PENDING_REASON_VALUES,
  PENDING_STATUS_VALUES,
  PHOTO_PREFERENCE_VALUES,
  PREFERRED_LENGTH_VALUES,
  PRIORITY_VALUES,
  PROJECT_CATEGORY_VALUES,
  PROJECT_ITEM_KIND_VALUES,
  PROJECT_STATUS_VALUES,
  PUBLICATION_STATUS_VALUES,
  PUBLICATION_TYPE_VALUES,
  PUBLIC_ACCESS_VALUES,
  RECRUITER_SHARING_VALUES,
  REFERENCE_PERMISSION_VALUES,
  RESTRICTION_RULE_VALUES,
  RESUME_SECTION_VALUES,
  REVIEWED_BY_VALUES,
  SALARY_PERIOD_VALUES,
  SELF_ASSESSED_LEVEL_VALUES,
  SENIORITY_VALUES,
  SKILL_CATEGORY_VALUES,
  STATEMENT_KIND_VALUES,
  STUDY_MODALITY_VALUES,
  TONE_VALUES,
  TRI_STATE_VALUES,
  VISIBILITY_VALUES,
  VISUAL_STYLE_VALUES,
  WORK_MODE_VALUES,
  type RecordKind,
} from '@chameleon/contracts';
import {
  AUTONOMY_LABELS,
  AWARD_SCOPE_LABELS,
  CERTIFICATION_CATEGORY_LABELS,
  CERTIFICATION_STATUS_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_SUBTYPES_BY_KIND,
  CONTACT_SUBTYPE_LABELS,
  COURSE_STATUS_LABELS,
  DEGREE_TYPE_LABELS,
  EDUCATION_STATUS_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  EVIDENCE_TYPE_LABELS,
  EXPERIENCE_ITEM_KIND_LABELS,
  FREQUENCY_LABELS,
  LANGUAGE_LEVEL_LABELS,
  OUTPUT_FORMAT_LABELS,
  PARTICIPATION_TYPE_LABELS,
  PENDING_REASON_LABELS,
  PENDING_STATUS_LABELS,
  PHOTO_PREFERENCE_LABELS,
  PREFERRED_LENGTH_LABELS,
  PRIORITY_LABELS,
  PROJECT_CATEGORY_LABELS,
  PROJECT_ITEM_KIND_LABELS,
  PROJECT_STATUS_LABELS,
  PUBLICATION_STATUS_LABELS,
  PUBLICATION_TYPE_LABELS,
  PUBLIC_ACCESS_LABELS,
  RECRUITER_SHARING_LABELS,
  REFERENCE_PERMISSION_LABELS,
  RESTRICTION_RULE_LABELS,
  RESUME_SECTION_LABELS,
  REVIEWED_BY_LABELS,
  SALARY_PERIOD_LABELS,
  SELF_LEVEL_LABELS,
  SENIORITY_LABELS,
  SKILL_CATEGORY_LABELS,
  STATEMENT_KIND_LABELS,
  STUDY_MODALITY_LABELS,
  TONE_LABELS,
  TRI_STATE_LABELS,
  VISIBILITY_LABELS,
  VISUAL_STYLE_LABELS,
  WORK_MODE_LABELS,
  optionsOf,
  type Option,
} from './labels';

/**
 * Descricao declarativa dos formularios. Um unico motor (`form/FieldRenderer`) renderiza qualquer
 * tipo de registro ou bloco a partir destes dados, o que evita uma tela escrita a mao por secao.
 * Os nomes de campo seguem o contrato 2.1.0; a validacao real e sempre a dos schemas do contrato.
 */

export type OptionsOf = Option[] | ((values: Record<string, unknown>) => Option[]);

interface FieldBase {
  /** Caminho no registro (relativo ao grupo, quando dentro de um). */
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Campo privado por construcao (nunca vai a currículos); sinalizado em texto. */
  private?: boolean;
}

export type FieldDef =
  | (FieldBase & { kind: 'text'; input?: 'text' | 'url' | 'email' | 'tel' })
  | (FieldBase & { kind: 'textarea'; rows?: number })
  | (FieldBase & { kind: 'select'; options: OptionsOf })
  | (FieldBase & { kind: 'date'; allowPresent?: boolean })
  | (FieldBase & { kind: 'number'; step?: number })
  | (FieldBase & { kind: 'boolean' })
  | (FieldBase & { kind: 'list'; itemHint?: string })
  | (FieldBase & { kind: 'multi'; options: Option[] })
  | (FieldBase & { kind: 'ref'; refKinds: readonly RecordKind[] })
  | { kind: 'group'; name: string; label: string; hint?: string; fields: FieldDef[] };

export interface FieldGroup {
  id: string;
  title: string;
  description?: string;
  /** Grupos fechados ficam recolhidos ("Mais detalhes"): o formulario nunca abre inteiro de uma vez. */
  open?: boolean;
  fields: FieldDef[];
}

export interface FormSpec {
  groups: FieldGroup[];
}

const opts = optionsOf;

const text = (name: string, label: string, extra: Partial<FieldBase> = {}): FieldDef => ({
  kind: 'text',
  name,
  label,
  ...extra,
});
const url = (name: string, label: string, extra: Partial<FieldBase> = {}): FieldDef => ({
  kind: 'text',
  input: 'url',
  name,
  label,
  ...extra,
});
const area = (
  name: string,
  label: string,
  extra: Partial<FieldBase> & { rows?: number } = {},
): FieldDef => ({ kind: 'textarea', name, label, ...extra });
const date = (
  name: string,
  label: string,
  extra: Partial<FieldBase> & { allowPresent?: boolean } = {},
): FieldDef => ({
  kind: 'date',
  name,
  label,
  hint: extra.allowPresent
    ? 'Use AAAA, AAAA-MM ou AAAA-MM-DD. Marque "Atual" se ainda está em andamento.'
    : 'Use AAAA, AAAA-MM ou AAAA-MM-DD. Pode informar só o ano.',
  ...extra,
});
const select = (
  name: string,
  label: string,
  options: OptionsOf,
  extra: Partial<FieldBase> = {},
): FieldDef => ({ kind: 'select', name, label, options, ...extra });
const list = (name: string, label: string, extra: Partial<FieldBase> = {}): FieldDef => ({
  kind: 'list',
  name,
  label,
  hint: 'Um item por linha.',
  ...extra,
});
const multi = (name: string, label: string, options: Option[]): FieldDef => ({
  kind: 'multi',
  name,
  label,
  options,
});
const bool = (name: string, label: string, extra: Partial<FieldBase> = {}): FieldDef => ({
  kind: 'boolean',
  name,
  label,
  ...extra,
});
const group = (name: string, label: string, fields: FieldDef[], hint?: string): FieldDef => ({
  kind: 'group',
  name,
  label,
  fields,
  ...(hint !== undefined ? { hint } : {}),
});

const METRIC = group(
  'metric',
  'Métrica (opcional)',
  [
    text('name', 'O que foi medido'),
    text('value', 'Valor', { hint: 'Texto livre: 35%, 2 h, R$ 10 mil.' }),
    text('baseline', 'Valor de partida'),
    text('period', 'Período'),
    area('method', 'Como foi medido', { rows: 2 }),
  ],
  'Só preencha se você souber o número. Deixar em branco não significa que não houve resultado.',
);

const selfLevel = (name: string, label: string): FieldDef =>
  select(name, label, opts(SELF_ASSESSED_LEVEL_VALUES, SELF_LEVEL_LABELS));
const langLevel = (name: string, label: string): FieldDef =>
  select(name, label, opts(LANGUAGE_LEVEL_VALUES, LANGUAGE_LEVEL_LABELS));
const triState = (name: string, label: string): FieldDef =>
  select(name, label, opts(TRI_STATE_VALUES, TRI_STATE_LABELS));
const workModes = opts(WORK_MODE_VALUES, WORK_MODE_LABELS);

// ---------------------------------------------------------------------------------------------
// Registros

export const RECORD_FORMS: Readonly<Partial<Record<RecordKind, FormSpec>>> = {
  contact_point: {
    groups: [
      {
        id: 'main',
        title: 'Contato',
        open: true,
        fields: [
          select('kind', 'Tipo', opts(CONTACT_KIND_VALUES, CONTACT_KIND_LABELS), {
            required: true,
          }),
          select(
            'subtype',
            'Subtipo',
            (values) => {
              const kind = values.kind;
              const allowed =
                typeof kind === 'string' && kind in CONTACT_SUBTYPES_BY_KIND
                  ? CONTACT_SUBTYPES_BY_KIND[kind as keyof typeof CONTACT_SUBTYPES_BY_KIND]
                  : [];
              return allowed.map((value) => ({ value, label: CONTACT_SUBTYPE_LABELS[value] }));
            },
            { hint: 'Escolha primeiro o tipo.' },
          ),
          text('value', 'Valor', {
            required: true,
            hint: 'E-mail, telefone com DDD (ex.: +55 11 91234-5678) ou endereço começando com https://.',
          }),
        ],
      },
      {
        id: 'more',
        title: 'Uso e privacidade',
        fields: [
          text('label', 'Rótulo (opcional)'),
          select('visibility', 'Quem pode ver', opts(VISIBILITY_VALUES, VISIBILITY_LABELS)),
          bool('include_by_default', 'Incluir nos currículos por padrão'),
          bool('is_primary', 'É o contato principal deste tipo'),
          area('notes', 'Observações', { rows: 2 }),
        ],
      },
    ],
  },

  statement: {
    groups: [
      {
        id: 'main',
        title: 'Declaração',
        open: true,
        fields: [
          select('kind', 'Tipo de texto', opts(STATEMENT_KIND_VALUES, STATEMENT_KIND_LABELS), {
            required: true,
          }),
          area('text', 'Texto', { required: true, rows: 5 }),
          text('locale', 'Idioma do texto', { hint: 'Ex.: pt-BR, en-US.' }),
        ],
      },
    ],
  },

  competency_example: {
    groups: [
      {
        id: 'main',
        title: 'Exemplo',
        open: true,
        fields: [
          text('competency', 'Competência demonstrada'),
          area('situation', 'Situação'),
          area('action', 'O que você fez'),
          area('outcome_or_learning', 'Resultado ou aprendizado'),
        ],
      },
    ],
  },

  experience: {
    groups: [
      {
        id: 'main',
        title: 'Essencial',
        description: 'Preencha o que souber agora; o resto pode ficar para depois.',
        open: true,
        fields: [
          text('organization_name', 'Organização'),
          text('display_title', 'Cargo ou função (como quer apresentar)'),
          text('official_title', 'Cargo oficial (se for diferente)'),
          date('start_date', 'Início'),
          date('end_date', 'Fim', { allowPresent: true }),
          select(
            'employment_type',
            'Tipo de vínculo',
            opts(EMPLOYMENT_TYPE_VALUES, EMPLOYMENT_TYPE_LABELS),
          ),
        ],
      },
      {
        id: 'where',
        title: 'Local e modalidade',
        fields: [
          select('work_mode', 'Modalidade', workModes),
          group('location', 'Local', [
            text('city', 'Cidade'),
            text('region', 'Estado ou região'),
            text('country', 'País'),
          ]),
          text('industry', 'Setor'),
          text('department', 'Departamento'),
          text('manager_or_team', 'Gestor(a) ou equipe'),
          text('workload', 'Carga horária'),
        ],
      },
      {
        id: 'context',
        title: 'Contexto e escopo',
        fields: [
          text('organization_public_name', 'Nome público da organização', {
            hint: 'Use quando o nome real não puder aparecer em currículos.',
          }),
          text('organization_group', 'Grupo de cargos no mesmo empregador'),
          area('company_context', 'Sobre a organização'),
          area('role_objective', 'Objetivo da função'),
          area('products_services_users', 'Produtos, serviços e usuários'),
          area('operational_scope', 'Escopo de atuação'),
          list('team_interfaces', 'Áreas com que interagia'),
        ],
      },
      {
        id: 'learning',
        title: 'Aprendizados',
        fields: [
          list('transferable_skills', 'Habilidades transferíveis'),
          list('lessons_learned', 'Lições aprendidas'),
        ],
      },
      {
        id: 'business',
        title: 'Negócio próprio (se aplicável)',
        fields: [
          group('business', 'Negócio', [
            text('activity', 'Atividade'),
            area('client_market_description', 'Clientes e mercado'),
            list('services_scope', 'Serviços oferecidos'),
            { kind: 'number', name: 'client_count', label: 'Quantidade de clientes' },
            url('portfolio_url', 'Endereço do portfólio'),
          ]),
        ],
      },
      {
        id: 'private',
        title: 'Informações privadas',
        description: 'Nada daqui vai para currículos.',
        fields: [
          area('exit_reason', 'Motivo da saída', { private: true, rows: 2 }),
          select(
            'reference_contact_permission',
            'Posso ser contatado(a) como referência?',
            opts(REFERENCE_PERMISSION_VALUES, REFERENCE_PERMISSION_LABELS),
          ),
        ],
      },
    ],
  },

  experience_item: {
    groups: [
      {
        id: 'main',
        title: 'Item',
        open: true,
        fields: [
          select('kind', 'Tipo', opts(EXPERIENCE_ITEM_KIND_VALUES, EXPERIENCE_ITEM_KIND_LABELS), {
            required: true,
          }),
          area('text', 'Descrição', { required: true }),
        ],
      },
      {
        id: 'detail',
        title: 'Detalhes',
        fields: [
          area('personal_contribution', 'Sua contribuição pessoal'),
          area('problem', 'Problema enfrentado'),
          area('outcome', 'Resultado'),
          METRIC,
          select('frequency', 'Frequência', opts(FREQUENCY_VALUES, FREQUENCY_LABELS)),
          select('autonomy', 'Autonomia', opts(AUTONOMY_VALUES, AUTONOMY_LABELS)),
          list('collaborators', 'Quem colaborou'),
          list('steps', 'Etapas'),
          area('verification', 'Como isso pode ser verificado'),
        ],
      },
    ],
  },

  project: {
    groups: [
      {
        id: 'main',
        title: 'Essencial',
        open: true,
        fields: [
          text('name', 'Nome do projeto'),
          text('one_line_description', 'Descrição em uma linha'),
          select('category', 'Categoria', opts(PROJECT_CATEGORY_VALUES, PROJECT_CATEGORY_LABELS)),
          select('status', 'Situação', opts(PROJECT_STATUS_VALUES, PROJECT_STATUS_LABELS)),
          text('role', 'Seu papel'),
          date('start_date', 'Início'),
          date('end_date', 'Fim', { allowPresent: true }),
        ],
      },
      {
        id: 'links',
        title: 'Links e acesso',
        fields: [
          select(
            'public_access',
            'Acesso público',
            opts(PUBLIC_ACCESS_VALUES, PUBLIC_ACCESS_LABELS),
          ),
          text('license', 'Licença'),
          url('public_url', 'Endereço público'),
          url('repository_url', 'Repositório'),
          url('documentation_url', 'Documentação'),
          url('demo_url', 'Demonstração'),
        ],
      },
      {
        id: 'contribution',
        title: 'Sua contribuição',
        fields: [
          bool('team_based', 'Foi um projeto em equipe'),
          area('personal_contribution', 'O que foi feito por você'),
          area('contributions_by_others', 'O que foi feito por outras pessoas'),
          area('decision_ownership', 'Decisões que você tomou'),
        ],
      },
      {
        id: 'problem',
        title: 'Problema e solução',
        fields: [
          area('problem', 'Problema'),
          area('target_audience', 'Público'),
          area('need_addressed', 'Necessidade atendida'),
          area('proposed_solution', 'Solução proposta'),
          area('architecture', 'Arquitetura'),
          area('authentication_authorization', 'Autenticação e autorização'),
        ],
      },
      {
        id: 'learning',
        title: 'Aprendizados e próximos passos',
        fields: [
          list('known_limitations', 'Limitações conhecidas'),
          list('next_improvements', 'Próximas melhorias'),
          list('learning', 'Aprendizados'),
          list('feedback', 'Retornos recebidos'),
        ],
      },
      {
        id: 'resume',
        title: 'Para currículos',
        fields: [
          area('short_description', 'Descrição curta'),
          list('resume_keywords', 'Palavras-chave'),
          date('last_updated', 'Última atualização'),
          {
            kind: 'ref',
            name: 'related_experience_id',
            label: 'Experiência relacionada',
            refKinds: ['experience'],
          },
          {
            kind: 'ref',
            name: 'related_education_id',
            label: 'Formação relacionada',
            refKinds: ['education'],
          },
        ],
      },
    ],
  },

  project_item: {
    groups: [
      {
        id: 'main',
        title: 'Item',
        open: true,
        fields: [
          select('kind', 'Tipo', opts(PROJECT_ITEM_KIND_VALUES, PROJECT_ITEM_KIND_LABELS), {
            required: true,
          }),
          area('text', 'Descrição', { required: true }),
          METRIC,
        ],
      },
    ],
  },

  collaborator: {
    groups: [
      {
        id: 'main',
        title: 'Colaborador(a)',
        open: true,
        fields: [text('name_or_role', 'Nome ou função'), area('contribution', 'Contribuição')],
      },
    ],
  },

  education: {
    groups: [
      {
        id: 'main',
        title: 'Essencial',
        open: true,
        fields: [
          text('institution', 'Instituição'),
          text('course_name', 'Curso'),
          select('degree_type', 'Nível', opts(DEGREE_TYPE_VALUES, DEGREE_TYPE_LABELS)),
          select('status', 'Situação', opts(EDUCATION_STATUS_VALUES, EDUCATION_STATUS_LABELS)),
          date('start_date', 'Início'),
          date('completion_date', 'Conclusão'),
          date('expected_completion_date', 'Conclusão prevista'),
        ],
      },
      {
        id: 'detail',
        title: 'Detalhes',
        fields: [
          text('field_of_study', 'Área de estudo'),
          select('modality', 'Modalidade', opts(STUDY_MODALITY_VALUES, STUDY_MODALITY_LABELS)),
          text('location', 'Local'),
          text('qualification_awarded', 'Título obtido'),
          text('thesis_title', 'Título do trabalho final'),
          area('thesis_description', 'Descrição do trabalho final'),
          text('supervisor', 'Orientador(a)'),
          list('relevant_coursework', 'Disciplinas relevantes'),
          list('academic_projects', 'Projetos acadêmicos'),
          list('honors_scholarships_distinctions', 'Bolsas e distinções'),
          url('verification_url', 'Endereço para verificação'),
        ],
      },
    ],
  },

  course: {
    groups: [
      {
        id: 'main',
        title: 'Essencial',
        open: true,
        fields: [
          text('name', 'Nome do curso'),
          text('provider', 'Instituição ou plataforma'),
          select('status', 'Situação', opts(COURSE_STATUS_VALUES, COURSE_STATUS_LABELS)),
          date('start_date', 'Início'),
          date('completion_date', 'Conclusão'),
        ],
      },
      {
        id: 'detail',
        title: 'Detalhes',
        fields: [
          { kind: 'number', name: 'workload_hours', label: 'Carga horária (horas)' },
          bool('certificate_issued', 'Emitiu certificado'),
          list('topics', 'Tópicos'),
          list('skills_developed', 'Competências desenvolvidas'),
          list('activities_projects', 'Atividades e projetos'),
          list('relevant_job_families', 'Famílias de vagas relevantes'),
          url('verification_url', 'Endereço para verificação'),
        ],
      },
    ],
  },

  skill: {
    groups: [
      {
        id: 'main',
        title: 'Competência',
        description: 'Aqui você só nomeia a competência. Onde você a usou é registrado em seguida.',
        open: true,
        fields: [
          text('name', 'Nome', { required: true }),
          select('category', 'Categoria', opts(SKILL_CATEGORY_VALUES, SKILL_CATEGORY_LABELS)),
          selfLevel('self_assessed_level', 'Como você avalia seu nível'),
        ],
      },
      {
        id: 'detail',
        title: 'Detalhes',
        fields: [
          list('aliases', 'Outros nomes'),
          area('description', 'Descrição'),
          list('tasks_can_perform', 'O que você consegue fazer com isso'),
          date('last_used', 'Último uso'),
          text('duration_of_use', 'Tempo de uso'),
          area('limitations', 'Limitações'),
        ],
      },
      {
        id: 'study',
        title: 'Plano de estudo',
        fields: [
          group('study_plan', 'Plano', [
            area('scope', 'O que pretende estudar'),
            list('sources', 'Fontes de estudo'),
            area('practical_project', 'Projeto prático'),
            text('perceived_level', 'Nível percebido'),
            area('next_goal', 'Próximo objetivo'),
          ]),
        ],
      },
    ],
  },

  language: {
    groups: [
      {
        id: 'main',
        title: 'Idioma',
        open: true,
        fields: [
          text('language', 'Idioma', { required: true }),
          text('language_code', 'Código do idioma', { hint: 'Ex.: en, pt-BR.' }),
          langLevel('overall_level', 'Nível geral (escala CEFR)'),
          text('self_described_level', 'Nível, nas suas palavras', {
            hint: 'Ex.: "avançado", "fluente". Não é convertido em escala automaticamente.',
          }),
        ],
      },
      {
        id: 'skills',
        title: 'Por habilidade',
        fields: [
          langLevel('reading', 'Leitura'),
          langLevel('writing', 'Escrita'),
          langLevel('listening', 'Compreensão oral'),
          langLevel('speaking', 'Fala'),
          area('professional_usage', 'Uso profissional'),
        ],
      },
      {
        id: 'cert',
        title: 'Certificação do idioma',
        fields: [
          group('certification', 'Certificação', [
            text('name', 'Nome'),
            text('issuer', 'Emissor'),
            text('score', 'Pontuação'),
            date('assessment_date', 'Data da avaliação'),
            date('valid_until', 'Válida até'),
          ]),
        ],
      },
    ],
  },

  certification: {
    groups: [
      {
        id: 'main',
        title: 'Essencial',
        open: true,
        fields: [
          text('name', 'Nome'),
          text('issuer', 'Emissor'),
          select(
            'category',
            'Categoria',
            opts(CERTIFICATION_CATEGORY_VALUES, CERTIFICATION_CATEGORY_LABELS),
          ),
          select(
            'status',
            'Situação',
            opts(CERTIFICATION_STATUS_VALUES, CERTIFICATION_STATUS_LABELS),
          ),
          date('issue_date', 'Emissão'),
          date('expiration_date', 'Validade'),
        ],
      },
      {
        id: 'detail',
        title: 'Verificação',
        fields: [
          text('public_identifier', 'Identificador público'),
          url('verification_url', 'Endereço para verificação'),
        ],
      },
    ],
  },

  award: {
    groups: [
      {
        id: 'main',
        title: 'Prêmio',
        open: true,
        fields: [
          text('name', 'Nome'),
          text('organization', 'Organização'),
          date('date', 'Data'),
          select('scope', 'Alcance', opts(AWARD_SCOPE_VALUES, AWARD_SCOPE_LABELS)),
          area('context_and_criteria', 'Contexto e critérios'),
          area('personal_contribution', 'Sua contribuição'),
        ],
      },
    ],
  },

  publication: {
    groups: [
      {
        id: 'main',
        title: 'Essencial',
        open: true,
        fields: [
          text('title', 'Título'),
          select('type', 'Tipo', opts(PUBLICATION_TYPE_VALUES, PUBLICATION_TYPE_LABELS)),
          select('status', 'Situação', opts(PUBLICATION_STATUS_VALUES, PUBLICATION_STATUS_LABELS)),
          date('date', 'Data'),
        ],
      },
      {
        id: 'detail',
        title: 'Detalhes',
        fields: [
          text('venue_or_institution', 'Veículo ou instituição'),
          text('authorship', 'Autoria'),
          area('summary', 'Resumo'),
          area('personal_contribution', 'Sua contribuição'),
          list('topics_methods', 'Temas e métodos'),
          url('url', 'Endereço'),
          text('doi', 'DOI', { hint: 'Formato 10.xxxx/sufixo.' }),
        ],
      },
    ],
  },

  volunteering: {
    groups: [
      {
        id: 'main',
        title: 'Essencial',
        open: true,
        fields: [
          text('organization', 'Organização'),
          text('role', 'Papel'),
          select(
            'participation_type',
            'Tipo de participação',
            opts(PARTICIPATION_TYPE_VALUES, PARTICIPATION_TYPE_LABELS),
          ),
          date('start_date', 'Início'),
          date('end_date', 'Fim', { allowPresent: true }),
        ],
      },
      {
        id: 'detail',
        title: 'Detalhes',
        fields: [
          list('responsibilities', 'Responsabilidades'),
          area('audience', 'Público atendido'),
          list('outcomes', 'Resultados'),
        ],
      },
    ],
  },

  evidence: {
    groups: [
      {
        id: 'main',
        title: 'Evidência',
        description: 'Depois de salvar, vincule a evidência aos itens que ela sustenta.',
        open: true,
        fields: [
          select('type', 'Tipo', opts(EVIDENCE_TYPE_VALUES, EVIDENCE_TYPE_LABELS), {
            required: true,
          }),
          text('title', 'Título'),
          area('url_or_location', 'Endereço ou onde encontrar', {
            rows: 2,
            hint: 'Um link https:// ou a descrição de onde está (ex.: pasta física).',
          }),
        ],
      },
      {
        id: 'more',
        title: 'Compartilhamento',
        fields: [
          date('evidence_date', 'Data'),
          bool('is_public', 'É pública'),
          select(
            'recruiter_sharing',
            'Compartilhar com recrutadores',
            opts(RECRUITER_SHARING_VALUES, RECRUITER_SHARING_LABELS),
          ),
          area('notes', 'Observações', { rows: 2 }),
        ],
      },
    ],
  },

  pending_item: {
    groups: [
      {
        id: 'main',
        title: 'Pendência',
        open: true,
        fields: [
          text('subject', 'Assunto', { required: true }),
          select('reason', 'Motivo', opts(PENDING_REASON_VALUES, PENDING_REASON_LABELS)),
          area('reason_detail', 'Detalhe do motivo'),
          select('priority', 'Prioridade', opts(PRIORITY_VALUES, PRIORITY_LABELS)),
          select('status', 'Situação', opts(PENDING_STATUS_VALUES, PENDING_STATUS_LABELS)),
        ],
      },
      {
        id: 'detail',
        title: 'Como resolver',
        fields: [
          area('current_information', 'O que sabemos hoje'),
          list('known_variants', 'Variações conhecidas'),
          area('safe_statement_for_now', 'O que pode ser dito com segurança por enquanto'),
          area('confirmation_method', 'Como confirmar'),
        ],
      },
    ],
  },

  restriction: {
    groups: [
      {
        id: 'main',
        title: 'Restrição',
        open: true,
        fields: [
          group('target', 'Alvo', [text('term', 'Termo ou assunto a restringir')]),
          select('rule', 'Regra', opts(RESTRICTION_RULE_VALUES, RESTRICTION_RULE_LABELS), {
            required: true,
          }),
          area('reason', 'Motivo (opcional)', { rows: 2 }),
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------------------------
// Blocos (secoes singleton)

const identityVisibilityLabels: Record<(typeof IDENTITY_VISIBILITY_FIELDS)[number], string> = {
  full_name: 'Nome completo',
  preferred_name: 'Nome preferido',
  pronunciation: 'Pronúncia',
  country_of_residence: 'País de residência',
  city: 'Cidade',
  region: 'Estado ou região',
  timezone: 'Fuso horário',
};

export const BLOCK_FORMS: Readonly<Record<string, FormSpec>> = {
  identity: {
    groups: [
      {
        id: 'main',
        title: 'Quem é você',
        open: true,
        fields: [
          text('full_name', 'Nome completo'),
          text('preferred_name', 'Nome preferido'),
          text('pronunciation', 'Pronúncia do nome'),
          text('pronouns', 'Pronomes', { private: true }),
        ],
      },
      {
        id: 'where',
        title: 'Onde você está',
        fields: [
          text('country_of_residence', 'País de residência'),
          text('region', 'Estado ou região'),
          text('city', 'Cidade'),
          text('timezone', 'Fuso horário', { hint: 'Ex.: America/Sao_Paulo.' }),
          list('countries_of_work_interest', 'Países onde aceitaria trabalhar'),
          list('interface_languages', 'Idiomas de interface', {
            hint: 'Um por linha. Ex.: pt-BR.',
          }),
        ],
      },
      {
        id: 'visibility',
        title: 'O que pode aparecer em currículos',
        description:
          'Escolha, campo a campo, se pode aparecer. Sem escolha, o campo segue a regra geral da sua conta.',
        fields: [
          group(
            'field_visibility',
            'Visibilidade por campo',
            IDENTITY_VISIBILITY_FIELDS.map((name) =>
              select(
                name,
                identityVisibilityLabels[name],
                opts(VISIBILITY_VALUES, VISIBILITY_LABELS),
              ),
            ),
          ),
        ],
      },
    ],
  },

  positioning: {
    groups: [
      {
        id: 'main',
        title: 'Posicionamento',
        open: true,
        fields: [
          text('current_profession', 'Profissão atual'),
          text('current_job_title', 'Cargo atual'),
          select('current_seniority', 'Senioridade', opts(SENIORITY_VALUES, SENIORITY_LABELS)),
          text('professional_headline', 'Frase de apresentação profissional'),
        ],
      },
    ],
  },

  availability_preferences: {
    groups: [
      {
        id: 'main',
        title: 'Modelo de trabalho',
        description: 'Esta seção é privada: nunca vai para currículos.',
        open: true,
        fields: [
          multi('preferred_work_modes', 'Modalidades preferidas', workModes),
          multi('accepted_work_modes', 'Modalidades que aceita', workModes),
          list('target_regions_countries', 'Regiões ou países de interesse'),
          triState('willing_to_relocate', 'Aceita mudar de cidade'),
          triState('travel_availability', 'Aceita viajar'),
          area('travel_notes', 'Observações sobre viagens', { rows: 2 }),
        ],
      },
      {
        id: 'contract',
        title: 'Contratação',
        fields: [
          text('start_availability', 'Quando pode começar'),
          multi(
            'preferred_contract_types',
            'Tipos de vínculo preferidos',
            opts(EMPLOYMENT_TYPE_VALUES, EMPLOYMENT_TYPE_LABELS),
          ),
          text('preferred_workload', 'Carga horária preferida'),
          text('compatible_timezones_hours', 'Fusos e horários compatíveis'),
          group('salary_expectation', 'Expectativa salarial', [
            { kind: 'number', name: 'amount', label: 'Valor' },
            text('currency', 'Moeda', { hint: 'Código de 3 letras. Ex.: BRL.' }),
            select('period', 'Período', opts(SALARY_PERIOD_VALUES, SALARY_PERIOD_LABELS)),
            area('notes', 'Observações', { rows: 2 }),
          ]),
        ],
      },
      {
        id: 'environment',
        title: 'Ambiente e limites',
        fields: [
          list('desired_benefits', 'Benefícios desejados'),
          list('work_environment_preferences', 'Preferências de ambiente'),
          list('work_conditions', 'Condições de trabalho necessárias', {
            hint: 'Um item por linha. Evite detalhes médicos desnecessários.',
          }),
          list('deal_breakers', 'O que é inegociável'),
        ],
      },
    ],
  },

  career_preferences: {
    groups: [
      {
        id: 'main',
        title: 'Cargos e áreas',
        description: 'Esta seção é privada: nunca vai para currículos.',
        open: true,
        fields: [
          list('priority_job_titles', 'Cargos prioritários'),
          list('secondary_job_titles', 'Cargos secundários'),
          list('excluded_job_titles', 'Cargos que não quer'),
          list('accepted_equivalent_titles', 'Títulos equivalentes aceitos'),
          list('misleading_titles_to_avoid', 'Títulos enganosos a evitar'),
          multi(
            'target_seniority_levels',
            'Senioridades-alvo',
            opts(SENIORITY_VALUES, SENIORITY_LABELS),
          ),
        ],
      },
      {
        id: 'fields',
        title: 'Áreas e setores',
        fields: [
          list('fields_of_interest', 'Áreas de interesse'),
          list('preferred_industries', 'Setores preferidos'),
          list('excluded_industries', 'Setores a evitar'),
          list('professional_interests', 'Interesses profissionais'),
          list('problems_to_solve', 'Problemas que quer resolver'),
        ],
      },
      {
        id: 'goals',
        title: 'Objetivos e preferências',
        fields: [
          list('preferred_responsibilities', 'Responsabilidades preferidas'),
          list('responsibilities_to_avoid', 'Responsabilidades a evitar'),
          area('short_term_goals', 'Objetivos de curto prazo'),
          area('long_term_goals', 'Objetivos de longo prazo'),
          area('what_makes_a_job_interesting', 'O que torna uma vaga interessante'),
          area('work_balance_preference', 'Equilíbrio entre trabalho e vida'),
          triState('interest_in_adjacent_fields', 'Interesse em áreas vizinhas'),
          area('adjacent_fields_conditions', 'Condições para áreas vizinhas'),
        ],
      },
    ],
  },

  resume_preferences: {
    groups: [
      {
        id: 'main',
        title: 'Aparência do currículo',
        open: true,
        fields: [
          text('default_language', 'Idioma padrão', { hint: 'Ex.: pt-BR.' }),
          text('regional_variant', 'Variante regional', { hint: 'Ex.: pt-BR, en-GB.' }),
          select('tone', 'Tom', opts(TONE_VALUES, TONE_LABELS)),
          select(
            'preferred_length',
            'Tamanho',
            opts(PREFERRED_LENGTH_VALUES, PREFERRED_LENGTH_LABELS),
          ),
          multi(
            'output_formats',
            'Formatos de saída',
            opts(OUTPUT_FORMAT_VALUES, OUTPUT_FORMAT_LABELS),
          ),
          select('visual_style', 'Estilo visual', opts(VISUAL_STYLE_VALUES, VISUAL_STYLE_LABELS)),
          select(
            'photo_preference',
            'Foto',
            opts(PHOTO_PREFERENCE_VALUES, PHOTO_PREFERENCE_LABELS),
          ),
        ],
      },
      {
        id: 'content',
        title: 'Conteúdo',
        fields: [
          text('default_headline', 'Título padrão'),
          multi(
            'preferred_sections',
            'Seções preferidas',
            opts(RESUME_SECTION_VALUES, RESUME_SECTION_LABELS),
          ),
          multi(
            'sections_to_omit',
            'Seções a omitir',
            opts(RESUME_SECTION_VALUES, RESUME_SECTION_LABELS),
          ),
          list('preferred_vocabulary', 'Vocabulário preferido'),
          list('expressions_to_avoid', 'Expressões a evitar'),
          area('additional_style_notes', 'Outras observações de estilo', { rows: 4 }),
        ],
      },
    ],
  },

  additional_professional_context: {
    groups: [
      {
        id: 'main',
        title: 'Contexto profissional adicional',
        open: true,
        fields: [
          list('industry_knowledge', 'Conhecimento do setor'),
          list('standards_regulations', 'Normas e regulamentos'),
          list('specialized_equipment', 'Equipamentos especializados'),
          list('methods_processes_frameworks', 'Métodos, processos e frameworks'),
          area('international_experience', 'Experiência internacional'),
          area('distributed_team_experience', 'Experiência com equipes distribuídas'),
          area('stakeholder_experience', 'Relacionamento com partes interessadas'),
          area('other', 'Outros'),
        ],
      },
    ],
  },

  review: {
    groups: [
      {
        id: 'main',
        title: 'Revisão do perfil',
        open: true,
        fields: [
          date('profile_created_date', 'Perfil criado em'),
          date('last_reviewed_date', 'Última revisão'),
          select('reviewed_by', 'Revisado por', opts(REVIEWED_BY_VALUES, REVIEWED_BY_LABELS)),
          list('reviewed_sections', 'Seções revisadas'),
          list('items_to_update', 'Itens a atualizar'),
        ],
      },
    ],
  },
};

/** Todos os campos folha de um spec (nomes completos, p.ex. `location.city`), para `field_states`. */
export function leafFields(spec: FormSpec): { name: string; label: string; required: boolean }[] {
  const out: { name: string; label: string; required: boolean }[] = [];
  const walk = (fields: FieldDef[], prefix: string, labelPrefix: string): void => {
    for (const field of fields) {
      const full = prefix === '' ? field.name : `${prefix}.${field.name}`;
      if (field.kind === 'group') {
        walk(field.fields, full, `${field.label} › `);
      } else {
        out.push({
          name: full,
          label: `${labelPrefix}${field.label}`,
          required: field.required === true,
        });
      }
    }
  };
  for (const g of spec.groups) walk(g.fields, '', '');
  return out;
}
