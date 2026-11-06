import type { ResumeContent, ResumeExportTemplate } from '@chameleon/contracts';

/**
 * Layout-independent model of an APPROVED resume. HTML, DOCX and PDF are all rendered from it, so the text and
 * its order are the same in every file (and in any preview). Nothing is added or rewritten here: it only
 * reshapes `ResumeContent`.
 */

export interface RenderContact {
  kind: 'email' | 'phone' | 'link';
  /** The value as stored (classic template). */
  text: string;
  /** Shorter text for the modern template: links lose the scheme, `www.` and the trailing slash. */
  display: string;
  /** Safe link target (`mailto:`, `tel:` or `http(s)://`), or `null` when the value is not a safe link. */
  href: string | null;
}

export interface RenderEntry {
  heading: string;
  subheading: string | null;
  period: string | null;
  /** Supporting line: place (experience, education) or technologies (project). */
  detail: string | null;
  /** Safe http(s) link of the entry (a published project), or `null`. */
  url: string | null;
  bullets: string[];
}

export interface RenderSkillGroup {
  label: string;
  items: string[];
}

export interface RenderSection {
  id: string;
  kind: ResumeContent['sections'][number]['kind'];
  title: string;
  /** Summary is running text, not a list of entries. */
  paragraphs: string[];
  /** Key skills, shown as tags (modern) or one line (classic). */
  tags: string[];
  /** Skills grouped by category. */
  groups: RenderSkillGroup[];
  entries: RenderEntry[];
}

export interface RenderModel {
  language: string;
  paper: 'A4' | 'Letter';
  name: string;
  headline: string | null;
  location: string | null;
  contacts: RenderContact[];
  sections: RenderSection[];
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const HTTP = /^https?:\/\/[^\s<>"']+$/i;

/** `https://www.example.org/ana/` -> `example.org/ana`. Anything that is not an http(s) URL is kept. */
function shortLink(value: string): string {
  if (!HTTP.test(value)) return value;
  return value.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/+$/, '');
}

/**
 * Brazilian numbers stored as bare digits (`11987654321`, `+5511987654321`) read better as
 * `(11) 98765-4321`. Anything that is not clearly a Brazilian number is shown as stored.
 */
export function displayPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const national = value.trim().startsWith('+')
    ? digits.startsWith('55')
      ? digits.slice(2)
      : ''
    : digits;
  const prefix = value.trim().startsWith('+') ? '+55 ' : '';
  if (/^\d{11}$/.test(national)) {
    return `${prefix}(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (/^\d{10}$/.test(national)) {
    return `${prefix}(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return value;
}

function contactOf(kind: RenderContact['kind'], value: string): RenderContact {
  if (kind === 'email') {
    return {
      kind,
      text: value,
      display: value,
      href: EMAIL.test(value) ? `mailto:${value}` : null,
    };
  }
  if (kind === 'phone') {
    const digits = value.replace(/[^\d+]/g, '');
    return {
      kind,
      text: value,
      display: displayPhone(value),
      href: digits.length >= 6 ? `tel:${digits}` : null,
    };
  }
  return { kind, text: value, display: shortLink(value), href: HTTP.test(value) ? value : null };
}

export function toRenderModel(content: ResumeContent): RenderModel {
  return {
    language: content.language,
    paper: /^en-US$|^en$/i.test(content.language) ? 'Letter' : 'A4',
    name: content.header.name,
    headline: content.header.headline,
    location: content.header.location,
    contacts: content.header.contacts.map((contact) => contactOf(contact.kind, contact.value)),
    sections: content.sections.map((section) => {
      const base = { id: section.id, kind: section.kind, title: section.title };
      const texts = (entry: ResumeContent['sections'][number]['entries'][number]): string[] =>
        entry.bullets.map((bullet) => bullet.text);
      if (section.kind === 'summary') {
        return {
          ...base,
          paragraphs: section.entries.map((entry) => texts(entry).join(' ')),
          tags: [],
          groups: [],
          entries: [],
        };
      }
      if (section.kind === 'competencies') {
        return {
          ...base,
          paragraphs: [],
          tags: section.entries.flatMap(texts),
          groups: [],
          entries: [],
        };
      }
      if (section.kind === 'skills') {
        return {
          ...base,
          paragraphs: [],
          tags: [],
          groups: section.entries.map((entry) => ({ label: entry.heading, items: texts(entry) })),
          entries: [],
        };
      }
      return {
        ...base,
        paragraphs: [],
        tags: [],
        groups: [],
        entries: section.entries.map((entry) => ({
          heading: entry.heading,
          subheading: entry.subheading,
          period: entry.period,
          detail: entry.detail ?? null,
          url:
            entry.url !== undefined && entry.url !== null && HTTP.test(entry.url)
              ? entry.url
              : null,
          bullets: texts(entry),
        })),
      };
    }),
  };
}

/** `Linguagens: Python, TypeScript` — the text of one skill group in every file format. */
export function skillGroupLine(group: RenderSkillGroup): string {
  return `${group.label}: ${group.items.join(', ')}`;
}

/**
 * Every visible text of the model, in reading order, for the given template: the basis of the "same text in
 * DOCX and PDF" check. The modern template puts the company before the role and the location last in the
 * contact row; the classic one keeps the original order.
 */
export function textLinesOf(
  model: RenderModel,
  template: ResumeExportTemplate = 'modern',
): string[] {
  const modern = template === 'modern';
  const lines: string[] = [model.name];
  if (model.headline !== null) lines.push(model.headline);
  if (!modern && model.location !== null) lines.push(model.location);
  for (const contact of model.contacts) lines.push(modern ? contact.display : contact.text);
  if (modern && model.location !== null) lines.push(model.location);
  for (const section of model.sections) {
    lines.push(section.title, ...section.paragraphs);
    if (section.kind === 'competencies') {
      if (modern) lines.push(...section.tags);
      else if (section.tags.length > 0) lines.push(section.tags.join(' · '));
    }
    for (const group of section.groups) lines.push(skillGroupLine(group));
    for (const entry of section.entries) {
      if (modern && section.kind === 'experience') {
        // Company first, then the period (same line), then the role, then the place.
        lines.push(entry.subheading ?? entry.heading);
        if (entry.period !== null) lines.push(entry.period);
        if (entry.subheading !== null) lines.push(entry.heading);
        if (entry.detail !== null) lines.push(entry.detail);
        lines.push(...entry.bullets);
        continue;
      }
      if (modern && (section.kind === 'education' || section.kind === 'certifications')) {
        // Title and institution share a line; the period (year) is right-aligned; the place goes below.
        lines.push(entry.heading);
        if (entry.subheading !== null) lines.push(entry.subheading);
        if (entry.period !== null) lines.push(entry.period);
        if (entry.detail !== null) lines.push(entry.detail);
        continue;
      }
      if (modern && section.kind === 'languages') {
        lines.push(
          entry.subheading !== null ? `${entry.heading}: ${entry.subheading}` : entry.heading,
        );
        continue;
      }
      // The period shares the heading line (right-aligned), so it reads before the subheading.
      lines.push(entry.heading);
      if (entry.period !== null) lines.push(entry.period);
      if (entry.subheading !== null) lines.push(entry.subheading);
      if (modern && section.kind === 'projects') {
        lines.push(...entry.bullets);
        if (entry.detail !== null) lines.push(entry.detail);
      } else {
        if (entry.detail !== null) lines.push(entry.detail);
        lines.push(...entry.bullets);
      }
    }
  }
  return lines;
}
