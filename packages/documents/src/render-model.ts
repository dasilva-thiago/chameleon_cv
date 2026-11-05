import type { ResumeContent } from '@chameleon/contracts';

/**
 * Layout-independent model of an APPROVED resume. DOCX and PDF are both rendered from it, so the text and its
 * order are the same in both files (and in any preview). Nothing is added or rewritten here: it only reshapes
 * `ResumeContent`.
 */

export interface RenderContact {
  kind: 'email' | 'phone' | 'link';
  text: string;
  /** Safe link target (`mailto:`, `tel:` or `http(s)://`), or `null` when the value is not a safe link. */
  href: string | null;
}

export interface RenderEntry {
  heading: string;
  subheading: string | null;
  period: string | null;
  bullets: string[];
}

export interface RenderSection {
  id: string;
  kind: ResumeContent['sections'][number]['kind'];
  title: string;
  /** Skills and summary are running text, not a list of entries. */
  paragraphs: string[];
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

function contactOf(kind: RenderContact['kind'], value: string): RenderContact {
  if (kind === 'email') {
    return { kind, text: value, href: EMAIL.test(value) ? `mailto:${value}` : null };
  }
  if (kind === 'phone') {
    const digits = value.replace(/[^\d+]/g, '');
    return { kind, text: value, href: digits.length >= 6 ? `tel:${digits}` : null };
  }
  return { kind, text: value, href: HTTP.test(value) ? value : null };
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
      const running = section.kind === 'skills' || section.kind === 'summary';
      return {
        id: section.id,
        kind: section.kind,
        title: section.title,
        paragraphs: running
          ? section.entries.map((entry) =>
              entry.bullets
                .map((bullet) => bullet.text)
                .join(section.kind === 'skills' ? ' · ' : ' '),
            )
          : [],
        entries: running
          ? []
          : section.entries.map((entry) => ({
              heading: entry.heading,
              subheading: entry.subheading,
              period: entry.period,
              bullets: entry.bullets.map((bullet) => bullet.text),
            })),
      };
    }),
  };
}

/** Every visible text of the model, in reading order: the basis of the "same text in DOCX and PDF" check. */
export function textLinesOf(model: RenderModel): string[] {
  const lines: string[] = [model.name];
  if (model.headline !== null) lines.push(model.headline);
  if (model.location !== null) lines.push(model.location);
  for (const contact of model.contacts) lines.push(contact.text);
  for (const section of model.sections) {
    lines.push(section.title, ...section.paragraphs);
    for (const entry of section.entries) {
      // The period shares the heading line (right-aligned), so it reads before the subheading.
      lines.push(entry.heading);
      if (entry.period !== null) lines.push(entry.period);
      if (entry.subheading !== null) lines.push(entry.subheading);
      lines.push(...entry.bullets);
    }
  }
  return lines;
}
