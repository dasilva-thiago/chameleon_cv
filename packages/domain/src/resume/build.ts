import {
  RESUME_LIMITS,
  type ResumeBodySection,
  type ResumeBullet,
  type ResumeContact,
  type ResumeContent,
  type ResumeEntry,
} from '@chameleon/contracts';
import type { BaseCv, BaseExperience } from '../cv/parse';
import { fold, tidy } from '../text/fold';

/**
 * Builds the structured resume (`ResumeContent`) from the parsed base CV, optionally tailored by an AI plan. What
 * the AI may change and what it may not mirrors career-ops' `pdf` mode:
 *
 * - it writes the headline, the summary, the key competencies, the bullets and the skill groups, and chooses and
 *   orders the projects;
 * - it never changes a job title, a company, a date, a place, a course or an institution: those come from the base
 *   for every entry it names. Every experience of the base is kept, in the base order (reverse chronological);
 *   a project the base does not have is dropped, and a link is only kept when the base has it.
 *
 * The result is checked afterwards by `validateResume` (numbers, terms, titles, phrases).
 */

export interface TailoredPlan {
  headline: string | null;
  summary: string | null;
  competencies: string[];
  experience: { company: string; bullets: string[] }[];
  projects: { name: string; bullets: string[] }[];
  skills: { group: string; items: string[] }[];
}

export interface BuildResult {
  content: ResumeContent;
  notes: string[];
}

const TITLES = {
  pt: {
    summary: 'Resumo profissional',
    competencies: 'Principais competências',
    experience: 'Experiência profissional',
    projects: 'Projetos',
    education: 'Formação acadêmica',
    skills: 'Habilidades',
    languages: 'Idiomas',
    certifications: 'Cursos e certificações',
  },
  en: {
    summary: 'Professional summary',
    competencies: 'Key skills',
    experience: 'Professional experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
    languages: 'Languages',
    certifications: 'Courses and certifications',
  },
} as const;

const labelsFor = (language: string) =>
  language.toLowerCase().startsWith('en') ? TITLES.en : TITLES.pt;

const line = (
  value: string | null | undefined,
  max: number = RESUME_LIMITS.line,
): string | null => {
  if (value === null || value === undefined) return null;
  const text = tidy(value, max);
  return text === '' ? null : text;
};

class Ids {
  private readonly used = new Set<string>();
  next(prefix: string): string {
    for (let n = 1; ; n += 1) {
      const id = `${prefix}-${String(n)}`;
      if (!this.used.has(id)) {
        this.used.add(id);
        return id;
      }
    }
  }
}

function bullets(ids: Ids, entryId: string, texts: readonly string[]): ResumeBullet[] {
  return texts
    .map((text) => tidy(text, RESUME_LIMITS.bulletText))
    .filter((text) => text !== '')
    .slice(0, RESUME_LIMITS.bulletsPerEntry)
    .map((text) => ({ id: ids.next(`${entryId}-b`), text, origin: 'generated' as const }));
}

function entry(
  ids: Ids,
  prefix: string,
  fields: {
    heading: string | null;
    subheading?: string | null;
    period?: string | null;
    detail?: string | null;
    url?: string | null;
    bullets?: readonly string[];
  },
): ResumeEntry | null {
  const heading = line(fields.heading);
  if (heading === null) return null;
  const id = ids.next(prefix);
  const url =
    fields.url !== undefined && fields.url !== null && /^https?:\/\/\S+$/i.test(fields.url)
      ? fields.url
      : null;
  return {
    id,
    heading,
    subheading: line(fields.subheading),
    period: line(fields.period, RESUME_LIMITS.period),
    detail: line(fields.detail),
    url,
    bullets: bullets(ids, id, fields.bullets ?? []),
  };
}

function section(
  ids: Ids,
  kind: ResumeBodySection['kind'],
  title: string,
  entries: (ResumeEntry | null)[],
): ResumeBodySection | null {
  const kept = entries.filter(
    (value): value is ResumeEntry =>
      value !== null &&
      (value.bullets.length > 0 || !['summary', 'competencies', 'skills'].includes(kind)),
  );
  if (kept.length === 0) return null;
  return {
    id: ids.next(kind),
    kind,
    title,
    entries: kept.slice(0, RESUME_LIMITS.entriesPerSection),
  };
}

/** Finds the base experience a plan entry names (company folded, either containing the other). */
export function findExperience(experiences: readonly BaseExperience[], company: string): number {
  const wanted = fold(company);
  if (wanted === '') return -1;
  const exact = experiences.findIndex((exp) => fold(exp.company) === wanted);
  if (exact !== -1) return exact;
  return experiences.findIndex((exp) => {
    const have = fold(exp.company);
    return have !== '' && (have.includes(wanted) || wanted.includes(have));
  });
}

function findProject(base: BaseCv, name: string): number {
  const wanted = fold(name);
  if (wanted === '') return -1;
  const exact = base.projects.findIndex((project) => fold(project.name) === wanted);
  if (exact !== -1) return exact;
  return base.projects.findIndex((project) => {
    const have = fold(project.name);
    return have.includes(wanted) || wanted.includes(have);
  });
}

function header(base: BaseCv, headline: string | null): ResumeContent['header'] {
  const contacts: ResumeContact[] = base.contacts
    .slice(0, RESUME_LIMITS.contacts)
    .map((contact) => ({ kind: contact.kind, value: contact.value, label: line(contact.label) }));
  return {
    name: line(base.name) ?? 'Nome',
    headline: line(headline) ?? line(base.headline),
    location: line(base.location),
    contacts,
  };
}

/** The resume built from the base alone (no AI): every section, in the order of the CV. */
export function buildBaseResume(base: BaseCv, language: string): ResumeContent {
  return buildResume(base, language, null).content;
}

export function buildResume(
  base: BaseCv,
  language: string,
  plan: TailoredPlan | null,
): BuildResult {
  const labels = labelsFor(language);
  const ids = new Ids();
  const notes: string[] = [];
  const sections: (ResumeBodySection | null)[] = [];

  const summary = plan?.summary ?? (base.summary.length > 0 ? base.summary.join(' ') : null);
  sections.push(
    section(ids, 'summary', labels.summary, [
      entry(ids, 'summary', { heading: labels.summary, bullets: summary ? [summary] : [] }),
    ]),
  );

  if (plan && plan.competencies.length > 0) {
    sections.push(
      section(ids, 'competencies', labels.competencies, [
        entry(ids, 'competencies', {
          heading: labels.competencies,
          bullets: [...new Set(plan.competencies.map((c) => tidy(c, 80)))].slice(0, 10),
        }),
      ]),
    );
  }

  // Experience: every base experience, in the base order; bullets from the plan when it names the company.
  const planBullets = new Map<number, string[]>();
  for (const item of plan?.experience ?? []) {
    const at = findExperience(base.experiences, item.company);
    if (at === -1) {
      notes.push(
        `A IA citou uma experiência que não está na base ("${tidy(item.company, 60)}"); ela foi ignorada.`,
      );
      continue;
    }
    if (item.bullets.length > 0) planBullets.set(at, item.bullets);
  }
  sections.push(
    section(
      ids,
      'experience',
      labels.experience,
      base.experiences.map((exp, index) =>
        entry(ids, 'exp', {
          heading: exp.title ?? exp.company,
          subheading:
            exp.title === null ? null : [exp.company, exp.descriptor].filter(Boolean).join(' · '),
          period: exp.period,
          detail: exp.location,
          bullets: planBullets.get(index) ?? exp.bullets,
        }),
      ),
    ),
  );

  // Projects: the plan's choice and order (only projects of the base), or all of them without a plan.
  const projectPicks: { index: number; bullets: string[] | null }[] = [];
  if (plan) {
    for (const item of plan.projects) {
      const at = findProject(base, item.name);
      if (at === -1) {
        notes.push(
          `A IA citou um projeto que não está na base ("${tidy(item.name, 60)}"); ele foi ignorado.`,
        );
        continue;
      }
      if (!projectPicks.some((pick) => pick.index === at)) {
        projectPicks.push({ index: at, bullets: item.bullets.length > 0 ? item.bullets : null });
      }
    }
  } else {
    base.projects.forEach((_, index) => projectPicks.push({ index, bullets: null }));
  }
  sections.push(
    section(
      ids,
      'projects',
      labels.projects,
      projectPicks.map(({ index, bullets: chosen }) => {
        const project = base.projects[index];
        if (project === undefined) return null;
        return entry(ids, 'proj', {
          heading: project.name,
          detail: project.tech,
          url: project.url,
          bullets: chosen ?? project.bullets,
        });
      }),
    ),
  );

  sections.push(
    section(
      ids,
      'education',
      labels.education,
      base.education.map((edu) =>
        entry(ids, 'edu', {
          heading: edu.course ?? edu.institution,
          subheading: edu.course === null ? null : edu.institution,
          period: edu.period,
          detail: edu.location,
          bullets: edu.details,
        }),
      ),
    ),
  );

  const skillGroups = plan && plan.skills.length > 0 ? plan.skills : base.skills;
  sections.push(
    section(
      ids,
      'skills',
      labels.skills,
      skillGroups.map((group) =>
        entry(ids, 'skills', {
          heading: group.group === '' ? labels.skills : group.group,
          bullets: group.items,
        }),
      ),
    ),
  );

  if (base.languages.length > 0) {
    sections.push(
      section(ids, 'languages', labels.languages, [
        entry(ids, 'lang', { heading: labels.languages, bullets: base.languages }),
      ]),
    );
  }
  if (base.courses.length > 0) {
    sections.push(
      section(ids, 'certifications', labels.certifications, [
        entry(ids, 'cert', { heading: labels.certifications, bullets: base.courses }),
      ]),
    );
  }

  return {
    content: {
      schemaVersion: 2,
      language,
      header: header(base, plan?.headline ?? null),
      sections: sections
        .filter((value): value is ResumeBodySection => value !== null)
        .slice(0, RESUME_LIMITS.sections),
    },
    notes,
  };
}

/** Marks edited text: a bullet whose text changed keeps its id but can no longer claim to be `generated`. */
export function reconcileOrigins(previous: ResumeContent, next: ResumeContent): ResumeContent {
  const before = new Map<string, { text: string; origin: string }>();
  for (const sec of previous.sections) {
    for (const item of sec.entries) {
      for (const bullet of item.bullets) before.set(bullet.id, bullet);
    }
  }
  return {
    ...next,
    sections: next.sections.map((sec) => ({
      ...sec,
      entries: sec.entries.map((item) => ({
        ...item,
        bullets: item.bullets.map((bullet) => {
          const old = before.get(bullet.id);
          if (old === undefined) return { ...bullet, origin: 'added' as const };
          if (old.text !== bullet.text) {
            return {
              ...bullet,
              origin: old.origin === 'added' ? ('added' as const) : ('edited' as const),
            };
          }
          return { ...bullet, origin: old.origin as ResumeBullet['origin'] };
        }),
      })),
    })),
  };
}

/** All visible text of a resume, for keyword coverage and checks. */
export function resumeText(content: ResumeContent): string {
  const parts: string[] = [content.header.name, content.header.headline ?? ''];
  for (const sec of content.sections) {
    for (const item of sec.entries) {
      parts.push(
        item.heading,
        item.subheading ?? '',
        item.detail ?? '',
        ...item.bullets.map((b) => b.text),
      );
    }
  }
  return parts.join('\n');
}
