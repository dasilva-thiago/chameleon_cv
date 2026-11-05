import type { ProfileDocument, ProfileSection, RecordKind } from '@chameleon/contracts';
import { blockOf, collectionOf, filledFieldCount, statusOf, type Json } from './document';

export type SectionGroupId = 'start' | 'trajectory' | 'skills' | 'preferences';

export interface SectionDef {
  /** Segmento da URL (`/perfil/:slug`). */
  slug: string;
  section: ProfileSection;
  label: string;
  description: string;
  group: SectionGroupId;
  /** Bloco singleton (formulario unico) ou colecao de registros. */
  type: 'block' | 'collection';
  recordKind?: RecordKind;
  /** Texto do estado vazio. Nunca afirma ausencia de experiencia, formacao ou competencia. */
  emptyText: string;
  addLabel?: string;
}

export const SECTION_GROUPS: readonly { id: SectionGroupId; label: string }[] = [
  { id: 'start', label: 'Para começar' },
  { id: 'trajectory', label: 'Trajetória' },
  { id: 'skills', label: 'Competências e reconhecimentos' },
  { id: 'preferences', label: 'Preferências e regras' },
];

/**
 * Secoes de navegacao, na ordem em que sao oferecidas. Toda secao e opcional: nada aqui e
 * "obrigatorio" e o estado vazio apenas diz que ainda nao ha itens cadastrados.
 * `skill_usages` aparece dentro de Competencias; `pending_items` e `evidence` tem paineis proprios.
 */
export const SECTIONS: readonly SectionDef[] = [
  {
    slug: 'identidade',
    section: 'identity',
    label: 'Identidade',
    description: 'Nome, localização e o que pode aparecer em currículos.',
    group: 'start',
    type: 'block',
    emptyText: 'Ainda não preenchida.',
  },
  {
    slug: 'contatos',
    section: 'contact_points',
    label: 'Contatos',
    description: 'E-mails, telefones e links para seu portfólio ou perfis profissionais.',
    group: 'start',
    type: 'collection',
    recordKind: 'contact_point',
    emptyText: 'Nenhum contato cadastrado ainda.',
    addLabel: 'Adicionar contato',
  },
  {
    slug: 'posicionamento',
    section: 'positioning',
    label: 'Posicionamento',
    description: 'Profissão atual, cargo e como você se apresenta.',
    group: 'start',
    type: 'block',
    emptyText: 'Ainda não preenchido.',
  },
  {
    slug: 'apresentacao',
    section: 'statements',
    label: 'Apresentação',
    description: 'Resumos e textos sobre você, no seu jeito de falar.',
    group: 'start',
    type: 'collection',
    recordKind: 'statement',
    emptyText: 'Nenhum texto de apresentação cadastrado ainda.',
    addLabel: 'Adicionar texto',
  },
  {
    slug: 'experiencias',
    section: 'experiences',
    label: 'Experiências',
    description: 'Empregos, estágios, trabalhos autônomos e outras atuações profissionais.',
    group: 'trajectory',
    type: 'collection',
    recordKind: 'experience',
    emptyText: 'Nenhuma experiência cadastrada ainda.',
    addLabel: 'Adicionar experiência',
  },
  {
    slug: 'projetos',
    section: 'projects',
    label: 'Projetos',
    description: 'Projetos pessoais, acadêmicos, abertos ou profissionais.',
    group: 'trajectory',
    type: 'collection',
    recordKind: 'project',
    emptyText: 'Nenhum projeto cadastrado ainda.',
    addLabel: 'Adicionar projeto',
  },
  {
    slug: 'formacao',
    section: 'education',
    label: 'Formação',
    description: 'Ensino médio, técnico, graduação e pós-graduação.',
    group: 'trajectory',
    type: 'collection',
    recordKind: 'education',
    emptyText: 'Nenhuma formação cadastrada ainda.',
    addLabel: 'Adicionar formação',
  },
  {
    slug: 'cursos',
    section: 'courses',
    label: 'Cursos',
    description: 'Cursos livres, treinamentos e oficinas.',
    group: 'trajectory',
    type: 'collection',
    recordKind: 'course',
    emptyText: 'Nenhum curso cadastrado ainda.',
    addLabel: 'Adicionar curso',
  },
  {
    slug: 'voluntariado',
    section: 'volunteering',
    label: 'Voluntariado',
    description: 'Atuação voluntária, comunitária ou associativa.',
    group: 'trajectory',
    type: 'collection',
    recordKind: 'volunteering',
    emptyText: 'Nenhuma atividade cadastrada ainda.',
    addLabel: 'Adicionar atividade',
  },
  {
    slug: 'competencias',
    section: 'skills',
    label: 'Competências',
    description: 'O que você sabe fazer e onde usou cada coisa.',
    group: 'skills',
    type: 'collection',
    recordKind: 'skill',
    emptyText: 'Nenhuma competência cadastrada ainda.',
    addLabel: 'Adicionar competência',
  },
  {
    slug: 'idiomas',
    section: 'languages',
    label: 'Idiomas',
    description: 'Idiomas que você fala, lê ou escreve.',
    group: 'skills',
    type: 'collection',
    recordKind: 'language',
    emptyText: 'Nenhum idioma cadastrado ainda.',
    addLabel: 'Adicionar idioma',
  },
  {
    slug: 'certificacoes',
    section: 'certifications',
    label: 'Certificações',
    description: 'Certificações, licenças e credenciais.',
    group: 'skills',
    type: 'collection',
    recordKind: 'certification',
    emptyText: 'Nenhuma certificação cadastrada ainda.',
    addLabel: 'Adicionar certificação',
  },
  {
    slug: 'premios',
    section: 'awards',
    label: 'Prêmios',
    description: 'Prêmios e reconhecimentos.',
    group: 'skills',
    type: 'collection',
    recordKind: 'award',
    emptyText: 'Nenhum prêmio cadastrado ainda.',
    addLabel: 'Adicionar prêmio',
  },
  {
    slug: 'publicacoes',
    section: 'publications',
    label: 'Publicações',
    description: 'Artigos, livros, palestras e outras publicações.',
    group: 'skills',
    type: 'collection',
    recordKind: 'publication',
    emptyText: 'Nenhuma publicação cadastrada ainda.',
    addLabel: 'Adicionar publicação',
  },
  {
    slug: 'exemplos',
    section: 'competency_examples',
    label: 'Exemplos de competência',
    description: 'Histórias curtas que mostram uma competência na prática.',
    group: 'skills',
    type: 'collection',
    recordKind: 'competency_example',
    emptyText: 'Nenhum exemplo cadastrado ainda.',
    addLabel: 'Adicionar exemplo',
  },
  {
    slug: 'disponibilidade',
    section: 'availability_preferences',
    label: 'Disponibilidade',
    description: 'Modelo de trabalho, mudança, viagens e contratação. Sempre privado.',
    group: 'preferences',
    type: 'block',
    emptyText: 'Ainda não preenchida.',
  },
  {
    slug: 'objetivos',
    section: 'career_preferences',
    label: 'Objetivos de carreira',
    description: 'Cargos, áreas e metas. Sempre privado.',
    group: 'preferences',
    type: 'block',
    emptyText: 'Ainda não preenchidos.',
  },
  {
    slug: 'curriculo',
    section: 'resume_preferences',
    label: 'Preferências de currículo',
    description: 'Idioma, tom, tamanho e estilo dos currículos gerados.',
    group: 'preferences',
    type: 'block',
    emptyText: 'Ainda não preenchidas.',
  },
  {
    slug: 'contexto',
    section: 'additional_professional_context',
    label: 'Contexto adicional',
    description: 'Conhecimentos e experiências que não cabem nas outras seções.',
    group: 'preferences',
    type: 'block',
    emptyText: 'Ainda não preenchido.',
  },
  {
    slug: 'restricoes',
    section: 'usage_rules',
    label: 'Restrições de uso',
    description: 'Termos e assuntos que não devem aparecer, ou só com sua aprovação.',
    group: 'preferences',
    type: 'collection',
    recordKind: 'restriction',
    emptyText: 'Nenhuma restrição cadastrada ainda.',
    addLabel: 'Adicionar restrição',
  },
  {
    slug: 'revisao-do-perfil',
    section: 'review',
    label: 'Revisão do perfil',
    description: 'Quando e por quem o perfil foi revisado.',
    group: 'preferences',
    type: 'block',
    emptyText: 'Ainda não preenchida.',
  },
];

export function sectionBySlug(slug: string | undefined): SectionDef | undefined {
  return SECTIONS.find((section) => section.slug === slug);
}

export type CompletionState = 'empty' | 'started' | 'to_review' | 'reviewed';

export interface Completion {
  state: CompletionState;
  count: number;
  toReview: number;
  /** Texto curto do estado, sem implicar ausencia de experiencia ou de qualquer fato. */
  text: string;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** Colecoes contam registros (e quantos faltam revisar); blocos contam campos preenchidos. */
export function completionOf(def: SectionDef, document: ProfileDocument | null): Completion {
  if (def.type === 'block') {
    const count = filledFieldCount(blockOf(document, def.section));
    return {
      state: count === 0 ? 'empty' : 'started',
      count,
      toReview: 0,
      text:
        count === 0
          ? 'Ainda não preenchida'
          : plural(count, 'campo preenchido', 'campos preenchidos'),
    };
  }
  let records: Json[];
  if (def.section === 'usage_rules') {
    const rules = blockOf(document, 'usage_rules');
    records = Array.isArray(rules?.restrictions) ? (rules.restrictions as Json[]) : [];
  } else {
    records = collectionOf(document, def.section);
  }
  const count = records.length;
  if (count === 0) return { state: 'empty', count: 0, toReview: 0, text: 'Nenhum item cadastrado' };
  const governed =
    def.recordKind !== undefined && !['contact_point', 'restriction'].includes(def.recordKind);
  const toReview = governed
    ? records.filter((record) => statusOf(record) === 'needs_review').length
    : 0;
  if (toReview > 0) {
    return {
      state: 'to_review',
      count,
      toReview,
      text: `${plural(count, 'item', 'itens')} · ${String(toReview)} para revisar`,
    };
  }
  return {
    state: governed ? 'reviewed' : 'started',
    count,
    toReview: 0,
    text: plural(count, 'item', 'itens'),
  };
}

/** Secao (slug) onde um tipo de registro e editado; filhos apontam para a secao do pai. */
export function slugForKind(kind: RecordKind): string | undefined {
  const nested: Partial<Record<RecordKind, RecordKind>> = {
    experience_item: 'experience',
    project_item: 'project',
    collaborator: 'project',
    skill_usage: 'skill',
  };
  const target = nested[kind] ?? kind;
  return SECTIONS.find((section) => section.recordKind === target)?.slug;
}
