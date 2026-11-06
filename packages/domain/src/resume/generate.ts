import {
  RESUME_LIMITS,
  type AnalysisReview,
  type AnalysisResult,
  type ProfileDocument,
  type ResumeBullet,
  type ResumeContent,
  type ResumeEntry,
  type ResumeBodySection,
} from '@chameleon/contracts';
import { buildMatchIndex, type IndexedFact, type MatchIndex } from '../matching/profile-index';

/**
 * Deterministic resume generation: every line is copied from a confirmed, resume-allowed, non-private profile
 * fact and carries that fact's id. Nothing is paraphrased, summarized or invented; what does not fit the
 * limits is left out and reported in `notes`. The analysis only decides WHAT to show first (its plan) and the
 * owner review decides what to hide or force.
 */

export interface GenerateOptions {
  analysis: AnalysisResult | null;
  review: AnalysisReview;
  /** Overrides the language taken from the profile (`pt-BR` by default). */
  language?: string;
}

export interface GeneratedResume {
  content: ResumeContent;
  /** Human-readable remarks about what was left out and why. */
  notes: string[];
}

type Json = Record<string, unknown>;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const isJson = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const TITLES = {
  pt: {
    summary: 'Resumo profissional',
    competencies: 'Principais competências',
    competenciesEntry: 'Principais competências',
    skills: 'Habilidades',
    skillCategories: {
      language: 'Linguagens',
      framework: 'Frameworks e bibliotecas',
      library: 'Frameworks e bibliotecas',
      database: 'Dados e bancos de dados',
      tool: 'Ferramentas e infraestrutura',
      method: 'Práticas e métodos',
      domain: 'Áreas de conhecimento',
      soft_skill: 'Competências comportamentais',
      other: 'Outras',
    },
    experience: 'Experiência profissional',
    projects: 'Projetos',
    education: 'Formação acadêmica',
    certifications: 'Certificações e cursos',
    languages: 'Idiomas',
    present: 'Atual',
    expected: 'previsão',
    unnamed: 'Nome não informado',
  },
  en: {
    summary: 'Professional summary',
    competencies: 'Key skills',
    competenciesEntry: 'Key skills',
    skills: 'Skills',
    skillCategories: {
      language: 'Languages',
      framework: 'Frameworks and libraries',
      library: 'Frameworks and libraries',
      database: 'Data and databases',
      tool: 'Tools and infrastructure',
      method: 'Practices and methods',
      domain: 'Knowledge areas',
      soft_skill: 'Soft skills',
      other: 'Other',
    },
    experience: 'Professional experience',
    projects: 'Projects',
    education: 'Education',
    certifications: 'Certifications and courses',
    languages: 'Languages',
    present: 'Present',
    expected: 'expected',
    unnamed: 'Name not provided',
  },
} as const;

function labelsFor(language: string): (typeof TITLES)[keyof typeof TITLES] {
  return language.toLowerCase().startsWith('en') ? TITLES.en : TITLES.pt;
}

/** `2024` -> `2024`, `2024-03` -> `03/2024`, `2024-03-15` -> `15/03/2024`, `present` -> Atual/Present. */
export function formatPartialDate(value: unknown, present: string): string | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  if (text === 'present') return present;
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text);
  if (!match) return undefined;
  const [, year, month, day] = match;
  if (month === undefined) return year;
  return day === undefined ? `${month}/${String(year)}` : `${day}/${month}/${String(year)}`;
}

function period(
  start: unknown,
  end: unknown,
  labels: { present: string },
  fallbackEnd?: string,
): string | null {
  const from = formatPartialDate(start, labels.present);
  const to = formatPartialDate(end, labels.present) ?? fallbackEnd;
  if (from !== undefined && to !== undefined) return from === to ? from : `${from} – ${to}`;
  return from ?? to ?? null;
}

const sortKey = (value: unknown): string => {
  const text = str(value);
  return text === undefined || text === 'present' ? '9999' : text;
};

/** `Pindamonhangaba - SP` from a location object, or the plain string. */
function placeOf(value: unknown): string | null {
  if (typeof value === 'string') return str(value) ?? null;
  if (!isJson(value)) return null;
  const parts = [str(value.city), str(value.region)].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(' - ') : null;
}

/** Comma-joined keywords that fit one line (cut at a whole item, never mid-word). */
function lineOfKeywords(value: unknown, max: number): string | null {
  if (!Array.isArray(value)) return null;
  const picked: string[] = [];
  for (const raw of value) {
    const word = str(raw);
    if (word === undefined || picked.includes(word)) continue;
    if ([...picked, word].join(', ').length > max) break;
    picked.push(word);
  }
  return picked.length > 0 ? picked.join(', ') : null;
}

const HTTP_URL = /^https?:\/\/\S+$/i;

/** Newest first by end date (open-ended first), then by start date. */
function byRecency(a: IndexedFact, b: IndexedFact): number {
  const end = sortKey(b.value.end_date ?? b.value.completion_date).localeCompare(
    sortKey(a.value.end_date ?? a.value.completion_date),
  );
  if (end !== 0) return end;
  return sortKey(b.value.start_date).localeCompare(sortKey(a.value.start_date));
}

class Ids {
  private readonly counts = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, n);
    return `${prefix}-${String(n)}`;
  }
}

export function generateResume(
  document: ProfileDocument,
  options: GenerateOptions,
): GeneratedResume {
  const index: MatchIndex = buildMatchIndex(document);
  const profile = document.profile as Json;
  const notes: string[] = [];
  const ids = new Ids();

  const resumePrefs = isJson(profile.resume_preferences) ? profile.resume_preferences : {};
  const language =
    options.language ?? str(document.locale) ?? str(resumePrefs.default_language) ?? 'pt-BR';
  const labels = labelsFor(language);

  const excluded = new Set(options.review.excludedRecordIds.map((id) => id.toLowerCase()));
  const pinned = new Set(options.review.pinnedRecordIds.map((id) => id.toLowerCase()));
  const rank = new Map<string, number>();
  (options.analysis?.prioritized ?? []).forEach((item, position) => {
    rank.set(item.recordId.toLowerCase(), position);
  });

  const allowed = (fact: IndexedFact): boolean => fact.usable && !excluded.has(fact.id);
  const wanted = (fact: IndexedFact): boolean => rank.has(fact.id) || pinned.has(fact.id);
  const rankOf = (fact: IndexedFact): number =>
    pinned.has(fact.id) ? -1 : (rank.get(fact.id) ?? 1e9);
  const byRank = (a: IndexedFact, b: IndexedFact): number => rankOf(a) - rankOf(b);
  const children = (parent: IndexedFact, kind: string): IndexedFact[] =>
    index.facts.filter((fact) => fact.kind === kind && fact.parentId === parent.id);
  const ofKind = (kind: string): IndexedFact[] =>
    index.facts.filter((fact) => fact.kind === kind && allowed(fact));

  const fits = (text: string, what: string): boolean => {
    if (text.length <= RESUME_LIMITS.bulletText) return true;
    notes.push(
      `${what} foi omitido: o texto passa de ${String(RESUME_LIMITS.bulletText)} caracteres.`,
    );
    return false;
  };

  const bullet = (entryId: string, n: number, text: string, sourceId: string): ResumeBullet => ({
    id: `${entryId}-b${String(n)}`,
    text,
    sourceIds: [sourceId],
    origin: 'generated',
  });

  // --- header ------------------------------------------------------------------------------
  const identity = isJson(profile.identity) ? profile.identity : {};
  const visibility = isJson(identity.field_visibility) ? identity.field_visibility : {};
  const visible = (field: string): boolean => visibility[field] !== 'private';
  const name =
    (visible('full_name') ? str(identity.full_name) : undefined) ??
    (visible('preferred_name') ? str(identity.preferred_name) : undefined);
  if (name === undefined)
    notes.push('O nome não está disponível (privado ou vazio): preencha-o no currículo.');
  const place = [
    visible('city') ? str(identity.city) : undefined,
    visible('region') ? str(identity.region) : undefined,
    visible('country_of_residence') ? str(identity.country_of_residence) : undefined,
  ].filter((part): part is string => part !== undefined);
  const positioning = isJson(profile.positioning) ? profile.positioning : {};
  const contacts = index.facts
    .filter(
      (fact) =>
        fact.kind === 'contact_point' &&
        fact.value.visibility === 'public' &&
        fact.value.include_by_default !== false &&
        !excluded.has(fact.id),
    )
    .slice(0, RESUME_LIMITS.contacts)
    .flatMap((fact) => {
      const raw = fact.value.kind;
      const value = str(fact.value.value);
      if ((raw !== 'email' && raw !== 'phone' && raw !== 'link') || value === undefined) return [];
      const kind: 'email' | 'phone' | 'link' = raw;
      return [{ kind, value, label: str(fact.value.label) ?? null, sourceId: fact.id }];
    });

  const sections: ResumeBodySection[] = [];

  // --- summary -----------------------------------------------------------------------------
  const statement = ['short_summary', 'one_sentence_intro', 'full_summary']
    .flatMap((kind) => ofKind('statement').filter((fact) => fact.value.kind === kind))
    .find((fact) => {
      const text = str(fact.value.text);
      return text !== undefined && text.length <= RESUME_LIMITS.bulletText;
    });
  if (statement) {
    const entryId = ids.next('summary');
    sections.push({
      id: 'summary',
      kind: 'summary',
      title: labels.summary,
      entries: [
        {
          id: entryId,
          heading: labels.summary,
          subheading: null,
          period: null,
          bullets: [bullet(entryId, 1, str(statement.value.text) ?? '', statement.id)],
          sourceIds: [statement.id],
        },
      ],
    });
  } else if (ofKind('statement').length > 0) {
    notes.push(
      `O resumo foi omitido: nenhum texto confirmado cabe em ${String(RESUME_LIMITS.bulletText)} caracteres.`,
    );
  }

  // --- skills ------------------------------------------------------------------------------
  const weakOnly = (skill: IndexedFact): boolean => {
    const usages = index.usagesBySkill.get(skill.id)?.filter((usage) => usage.usable) ?? [];
    return (
      usages.length > 0 &&
      usages.every((u) => u.context === 'conceptual_familiarity' || u.context === 'unverified')
    );
  };
  const skills = ofKind('skill')
    .filter(
      (skill) =>
        (wanted(skill) || !weakOnly(skill)) &&
        str(skill.value.name) !== undefined &&
        str(skill.value.category) !== 'spoken_language',
    )
    .sort(byRank)
    .slice(0, 36);

  // "Principais competências": the few technical skills the analysis ranked first, shown as tags right after
  // the summary. The grouped "Habilidades" section below keeps the full list.
  const TAG_CATEGORIES = new Set([
    'language',
    'framework',
    'library',
    'database',
    'tool',
    'domain',
  ]);
  const topSkills = skills
    .filter((skill) => TAG_CATEGORIES.has(str(skill.value.category) ?? 'other'))
    .slice(0, 8);
  let competenciesSection: ResumeBodySection | undefined;
  if (topSkills.length > 0) {
    const entryId = ids.next('competencies');
    competenciesSection = {
      id: 'competencies',
      kind: 'competencies',
      title: labels.competencies,
      entries: [
        {
          id: entryId,
          heading: labels.competenciesEntry,
          subheading: null,
          period: null,
          bullets: topSkills.map((skill, n) =>
            bullet(entryId, n + 1, str(skill.value.name) ?? '', skill.id),
          ),
          sourceIds: topSkills.map((skill) => skill.id).slice(0, RESUME_LIMITS.sourcesPerItem),
        },
      ],
    };
  }

  // Grouped by the skill category, in a fixed, readable order.
  const CATEGORY_ORDER = [
    'language',
    'framework',
    'database',
    'tool',
    'method',
    'domain',
    'soft_skill',
    'other',
  ] as const;
  const categoryOf = (skill: IndexedFact): (typeof CATEGORY_ORDER)[number] => {
    const raw = str(skill.value.category);
    if (raw === 'library') return 'framework'; // same group label
    return (CATEGORY_ORDER as readonly string[]).includes(raw ?? '')
      ? (raw as (typeof CATEGORY_ORDER)[number])
      : 'other';
  };
  const skillEntries: ResumeEntry[] = CATEGORY_ORDER.flatMap((category) => {
    const members = skills
      .filter((skill) => categoryOf(skill) === category)
      .slice(0, RESUME_LIMITS.bulletsPerEntry);
    if (members.length === 0) return [];
    const entryId = ids.next('skills');
    return [
      {
        id: entryId,
        heading: labels.skillCategories[category],
        subheading: null,
        period: null,
        bullets: members.map((skill, n) =>
          bullet(entryId, n + 1, str(skill.value.name) ?? '', skill.id),
        ),
        sourceIds: members.map((skill) => skill.id).slice(0, RESUME_LIMITS.sourcesPerItem),
      },
    ];
  });
  const skillsSection: ResumeBodySection | undefined =
    skillEntries.length > 0
      ? { id: 'skills', kind: 'skills', title: labels.skills, entries: skillEntries }
      : undefined;
  if (competenciesSection) sections.push(competenciesSection);

  // --- experience --------------------------------------------------------------------------
  const experienceEntries: ResumeEntry[] = ofKind('experience')
    .sort(byRecency)
    .slice(0, RESUME_LIMITS.entriesPerSection)
    .flatMap((experience) => {
      const heading = str(experience.value.official_title) ?? str(experience.value.display_title);
      if (heading === undefined) {
        notes.push('Uma experiência sem cargo foi omitida: preencha o cargo no perfil.');
        return [];
      }
      const entryId = ids.next('experience');
      const items = children(experience, 'experience_item')
        .filter((item) => allowed(item) && str(item.value.text) !== undefined)
        .sort(byRank);
      const preferred = items.filter(wanted).slice(0, 6);
      const chosen =
        preferred.length >= 3
          ? preferred
          : [...preferred, ...items.filter((item) => !preferred.includes(item))].slice(0, 3);
      const bullets = chosen
        .filter((item) => fits(str(item.value.text) ?? '', 'Um item de experiência'))
        .map((item, n) => bullet(entryId, n + 1, str(item.value.text) ?? '', item.id));
      return [
        {
          id: entryId,
          heading,
          subheading:
            str(experience.value.organization_public_name) ??
            str(experience.value.organization_name) ??
            null,
          period: period(experience.value.start_date, experience.value.end_date, labels),
          detail: placeOf(experience.value.location),
          bullets,
          sourceIds: [experience.id],
        },
      ];
    });
  if (experienceEntries.length > 0) {
    sections.push({
      id: 'experience',
      kind: 'experience',
      title: labels.experience,
      entries: experienceEntries,
    });
  }

  // --- projects ----------------------------------------------------------------------------
  const allProjects = ofKind('project').sort(byRank);
  const projects = (
    allProjects.some(wanted) || experienceEntries.length > 0
      ? allProjects.filter(wanted)
      : allProjects
  ).slice(0, experienceEntries.length > 0 ? 4 : 3);
  // Only a project the owner marked as public may expose its link.
  const publicUrlOf = (project: IndexedFact): string | null => {
    const access = str(project.value.public_access);
    if (access !== 'public' && access !== 'partial') return null;
    const url = str(project.value.public_url) ?? str(project.value.repository_url);
    return url !== undefined && HTTP_URL.test(url) ? url : null;
  };
  const projectEntries: ResumeEntry[] = projects.flatMap((project) => {
    const heading = str(project.value.name);
    if (heading === undefined) return [];
    const entryId = ids.next('project');
    const items = children(project, 'project_item')
      .filter((item) => allowed(item) && str(item.value.text) !== undefined)
      .sort(byRank)
      .slice(0, 4);
    const texts: { text: string; sourceId: string }[] = items.map((item) => ({
      text: str(item.value.text) ?? '',
      sourceId: item.id,
    }));
    const contribution = str(project.value.personal_contribution);
    if (texts.length === 0 && contribution !== undefined) {
      texts.push({ text: contribution, sourceId: project.id });
    }
    // A project with no itemized facts still says what it is, in the owner's own words.
    const description =
      str(project.value.short_description) ?? str(project.value.one_line_description);
    if (texts.length === 0 && description !== undefined) {
      texts.push({ text: description, sourceId: project.id });
    }
    return [
      {
        id: entryId,
        heading,
        subheading: str(project.value.role) ?? null,
        period: period(project.value.start_date, project.value.end_date, labels),
        detail: lineOfKeywords(project.value.resume_keywords, RESUME_LIMITS.line),
        url: publicUrlOf(project),
        bullets: texts
          .filter((entry) => fits(entry.text, 'Um item de projeto'))
          .map((entry, n) => bullet(entryId, n + 1, entry.text, entry.sourceId)),
        sourceIds: [project.id],
      },
    ];
  });
  if (projectEntries.length > 0) {
    sections.push({
      id: 'projects',
      kind: 'projects',
      title: labels.projects,
      entries: projectEntries,
    });
  }

  // --- education ---------------------------------------------------------------------------
  const educationEntries: ResumeEntry[] = ofKind('education')
    .sort(byRecency)
    .slice(0, 6)
    .flatMap((education) => {
      const heading =
        str(education.value.course_name) ??
        str(education.value.field_of_study) ??
        str(education.value.qualification_awarded);
      if (heading === undefined) return [];
      const expected = formatPartialDate(education.value.expected_completion_date, labels.present);
      return [
        {
          id: ids.next('education'),
          heading,
          subheading: str(education.value.institution) ?? null,
          detail: placeOf(education.value.location),
          period: period(
            education.value.start_date,
            education.value.completion_date,
            labels,
            expected !== undefined ? `${labels.expected} ${expected}` : undefined,
          ),
          bullets: [],
          sourceIds: [education.id],
        },
      ];
    });
  if (educationEntries.length > 0) {
    sections.push({
      id: 'education',
      kind: 'education',
      title: labels.education,
      entries: educationEntries,
    });
  }

  // --- certifications and courses ----------------------------------------------------------
  const certificationEntries: ResumeEntry[] = [
    ...ofKind('certification')
      .sort((a, b) => sortKey(b.value.issue_date).localeCompare(sortKey(a.value.issue_date)))
      .slice(0, 6)
      .map((fact) => ({
        fact,
        heading: str(fact.value.name),
        subheading: str(fact.value.issuer),
        when: formatPartialDate(fact.value.issue_date, labels.present),
      })),
    ...ofKind('course')
      .filter(wanted)
      .sort(byRank)
      .slice(0, 4)
      .map((fact) => ({
        fact,
        heading: str(fact.value.name),
        subheading: str(fact.value.provider),
        when: formatPartialDate(fact.value.completion_date, labels.present),
      })),
  ].flatMap((item) =>
    item.heading === undefined
      ? []
      : [
          {
            id: ids.next('certification'),
            heading: item.heading,
            subheading: item.subheading ?? null,
            period: item.when ?? null,
            bullets: [],
            sourceIds: [item.fact.id],
          },
        ],
  );
  if (certificationEntries.length > 0) {
    sections.push({
      id: 'certifications',
      kind: 'certifications',
      title: labels.certifications,
      entries: certificationEntries,
    });
  }

  if (skillsSection) sections.push(skillsSection);

  // --- languages ---------------------------------------------------------------------------
  const languageEntries: ResumeEntry[] = ofKind('language').flatMap((language_) => {
    const heading = str(language_.value.language);
    if (heading === undefined) return [];
    return [
      {
        id: ids.next('language'),
        heading,
        subheading:
          str(language_.value.self_described_level) ?? str(language_.value.overall_level) ?? null,
        period: null,
        bullets: [],
        sourceIds: [language_.id],
      },
    ];
  });
  if (languageEntries.length > 0) {
    sections.push({
      id: 'languages',
      kind: 'languages',
      title: labels.languages,
      entries: languageEntries,
    });
  }

  if (sections.length === 0) {
    notes.push('Nenhum item confirmado pôde ser usado: confirme itens do perfil e gere de novo.');
  }
  return {
    content: {
      schemaVersion: 1,
      language,
      header: {
        name: name ?? labels.unnamed,
        headline: str(positioning.professional_headline) ?? null,
        location: place.length > 0 ? place.join(', ') : null,
        contacts,
      },
      sections,
    },
    notes,
  };
}
