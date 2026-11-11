/**
 * Reader of the CV in Markdown (the career-ops `cv.md` shape). It is deliberately tolerant: it never rejects a CV,
 * it only extracts what the program needs to build a resume without AI and to check a generated one (name, contacts,
 * the experiences with their exact titles and order, projects, education, skills...). Anything it does not
 * recognize stays in the raw text, which the AI and the fact checks still read in full.
 *
 * Expected shape (headings in Portuguese or English):
 *
 *     # CV -- Name
 *     **Headline:** ...        **Location:** ...      **Email:** ...    **LinkedIn:** https://...
 *     ## Professional Summary  (paragraphs)
 *     ## Work Experience       ### Company — City · Descriptor / **Title** / 2023 - 2025 / - bullets
 *     ## Projects              ### Name / https://url / Tech, list / - bullets
 *     ## Education             ### Institution — City / **Course** / Em andamento / extra lines
 *     ## Skills                - **Group:** a, b, c
 *     ## Languages / ## Courses  - items
 */

export interface BaseContact {
  kind: 'email' | 'phone' | 'link';
  label: string | null;
  value: string;
}

export interface BaseExperience {
  company: string;
  location: string | null;
  descriptor: string | null;
  title: string | null;
  period: string | null;
  bullets: string[];
}

export interface BaseProject {
  name: string;
  url: string | null;
  tech: string | null;
  bullets: string[];
}

export interface BaseEducation {
  institution: string;
  location: string | null;
  course: string | null;
  period: string | null;
  details: string[];
}

export interface BaseSkillGroup {
  group: string;
  items: string[];
}

export interface BaseCv {
  name: string | null;
  headline: string | null;
  location: string | null;
  contacts: BaseContact[];
  summary: string[];
  experiences: BaseExperience[];
  projects: BaseProject[];
  education: BaseEducation[];
  skills: BaseSkillGroup[];
  languages: string[];
  courses: string[];
}

type SectionKind =
  | 'summary'
  | 'experience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'languages'
  | 'courses'
  | 'other';

const SECTION_PATTERNS: [SectionKind, RegExp][] = [
  ['experience', /experi[eê]n|employment|work history|hist[oó]rico profissional/i],
  ['projects', /project|projeto/i],
  ['education', /education|forma[cç][aã]o|educa[cç][aã]o|escolaridade/i],
  ['languages', /language|idioma|l[ií]ngua/i],
  ['courses', /course|curso|certifica|treinamento/i],
  ['skills', /skill|habilidade|compet[eê]ncia|tecnologia|conhecimento/i],
  ['summary', /summary|resumo|perfil|sobre|about|objetivo/i],
];

function sectionKind(heading: string): SectionKind {
  for (const [kind, pattern] of SECTION_PATTERNS) if (pattern.test(heading)) return kind;
  return 'other';
}

const BOLD_LABEL = /^\*\*([^*:]+):\*\*\s*(.*)$/;
const BOLD_LINE = /^\*\*(.+?)\*\*\s*$/;
const BULLET = /^[-*+]\s+(.*)$/;
const URL = /^https?:\/\/\S+$/i;
const COMMENT = /<!--[\s\S]*?-->/g;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Inline markdown that should not reach a resume line: bold/italic markers and code ticks. */
export function stripInline(value: string): string {
  return clean(
    value
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`/g, ''),
  );
}

/** `Company — City · Descriptor` → parts. Splits on the first em/en dash or ` -- `; the descriptor after ` · `. */
function splitHeading(value: string): {
  main: string;
  place: string | null;
  descriptor: string | null;
} {
  const [head, ...rest] = stripInline(value).split(/\s+·\s+/);
  const descriptor = rest.length > 0 ? clean(rest.join(' · ')) : null;
  const match = /^(.*?)\s+(?:—|–|--)\s+(.*)$/.exec(head ?? '');
  if (match)
    return { main: clean(match[1] ?? ''), place: clean(match[2] ?? '') || null, descriptor };
  return { main: clean(head ?? ''), place: null, descriptor };
}

function contactOf(label: string, value: string): BaseContact | null {
  const key = label.toLowerCase();
  const text = stripInline(value);
  if (text === '') return null;
  if (/e-?mail/.test(key)) return { kind: 'email', label: null, value: text };
  if (/phone|telefone|celular|whats/.test(key)) return { kind: 'phone', label: null, value: text };
  if (URL.test(text)) return { kind: 'link', label: clean(label), value: text };
  return null;
}

interface Block {
  heading: string;
  lines: string[];
}

/** Lines under a `##` section, split into `###` blocks (lines before the first `###` go to an unnamed block). */
function blocksOf(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let current: Block = { heading: '', lines: [] };
  for (const line of lines) {
    const match = /^###\s+(.*)$/.exec(line);
    if (match) {
      if (current.heading !== '' || current.lines.some((l) => l.trim() !== ''))
        blocks.push(current);
      current = { heading: clean(match[1] ?? ''), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading !== '' || current.lines.some((l) => l.trim() !== '')) blocks.push(current);
  return blocks;
}

function bulletsOf(lines: string[]): string[] {
  return lines
    .map((line) => BULLET.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => stripInline(match[1] ?? ''))
    .filter((text) => text !== '');
}

function plainLines(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== '' && !BULLET.test(line) && !line.startsWith('#'));
}

function parseExperience(block: Block): BaseExperience | null {
  if (block.heading === '') return null;
  const { main, place, descriptor } = splitHeading(block.heading);
  const plain = plainLines(block.lines);
  const titleLine = plain.find((line) => BOLD_LINE.test(line));
  const title = titleLine ? stripInline(BOLD_LINE.exec(titleLine)?.[1] ?? '') : null;
  const rest = plain.filter((line) => line !== titleLine);
  return {
    company: main,
    location: place,
    descriptor,
    title: title === '' ? null : title,
    period: rest.length > 0 ? stripInline(rest[0] ?? '') : null,
    bullets: bulletsOf(block.lines),
  };
}

function parseProject(block: Block): BaseProject | null {
  if (block.heading === '') return null;
  const plain = plainLines(block.lines);
  const url = plain.find((line) => URL.test(line)) ?? null;
  const tech = plain.find((line) => line !== url) ?? null;
  return {
    name: stripInline(block.heading),
    url,
    tech: tech === null ? null : stripInline(tech),
    bullets: bulletsOf(block.lines),
  };
}

function parseEducation(block: Block): BaseEducation | null {
  if (block.heading === '') return null;
  const { main, place } = splitHeading(block.heading);
  const plain = plainLines(block.lines);
  const courseLine = plain.find((line) => BOLD_LINE.test(line));
  const course = courseLine ? stripInline(BOLD_LINE.exec(courseLine)?.[1] ?? '') : null;
  const rest = plain.filter((line) => line !== courseLine).map(stripInline);
  const looksLikePeriod = (line: string): boolean =>
    line.length <= 60 && /\d{4}|andamento|conclu|atual|present|cursando|previs/i.test(line);
  const period = rest.length > 0 && looksLikePeriod(rest[0] ?? '') ? (rest[0] ?? null) : null;
  return {
    institution: main,
    location: place,
    course: course === '' ? null : course,
    period,
    details: [...(period === null ? rest : rest.slice(1)), ...bulletsOf(block.lines)],
  };
}

function parseSkills(lines: string[]): BaseSkillGroup[] {
  const groups: BaseSkillGroup[] = [];
  for (const raw of lines) {
    const bullet = BULLET.exec(raw.trim());
    const text = bullet ? (bullet[1] ?? '') : raw.trim();
    if (text === '') continue;
    const labeled =
      /^\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(text) ?? /^([^:]{2,60}):\s+(.*)$/.exec(text);
    if (labeled) {
      const items = splitItems(labeled[2] ?? '');
      if (items.length > 0) groups.push({ group: stripInline(labeled[1] ?? ''), items });
    } else if (bullet) {
      const items = splitItems(text);
      if (items.length > 0) groups.push({ group: '', items });
    }
  }
  return groups;
}

function splitItems(value: string): string[] {
  return stripInline(value)
    .split(/\s*[,;•]\s*/)
    .map(clean)
    .filter((item) => item !== '');
}

export function parseBaseCv(markdown: string): BaseCv {
  const lines = markdown.replace(COMMENT, '').replace(/\r\n?/g, '\n').split('\n');
  const cv: BaseCv = {
    name: null,
    headline: null,
    location: null,
    contacts: [],
    summary: [],
    experiences: [],
    projects: [],
    education: [],
    skills: [],
    languages: [],
    courses: [],
  };

  const sections: { kind: SectionKind; lines: string[] }[] = [];
  let current: { kind: SectionKind; lines: string[] } | null = null;
  for (const line of lines) {
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1 && current === null) {
      const title = clean(h1[1] ?? '').replace(
        /^(cv|curr[ií]culo|resume|r[eé]sum[eé])\s*(--|—|–|-|:)\s*/i,
        '',
      );
      if (title !== '' && cv.name === null) cv.name = title;
      continue;
    }
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2 && !line.startsWith('###')) {
      current = { kind: sectionKind(h2[1] ?? ''), lines: [] };
      sections.push(current);
      continue;
    }
    if (current === null) {
      const labeled = BOLD_LABEL.exec(line.trim());
      if (!labeled) continue;
      const label = clean(labeled[1] ?? '');
      const value = labeled[2] ?? '';
      if (/headline|t[ií]tulo|cargo/i.test(label)) cv.headline = stripInline(value) || null;
      else if (/location|localiza|cidade|endere/i.test(label))
        cv.location = stripInline(value) || null;
      else if (/^(name|nome)$/i.test(label)) cv.name = stripInline(value) || cv.name;
      else {
        const contact = contactOf(label, value);
        if (contact) cv.contacts.push(contact);
      }
      continue;
    }
    current.lines.push(line);
  }

  for (const section of sections) {
    switch (section.kind) {
      case 'summary': {
        const paragraphs = section.lines
          .join('\n')
          .split(/\n\s*\n/)
          .map((part) => stripInline(part.replace(/^[-*+]\s+/gm, '')))
          .filter((part) => part !== '');
        cv.summary.push(...paragraphs);
        break;
      }
      case 'experience':
        for (const block of blocksOf(section.lines)) {
          const parsed = parseExperience(block);
          if (parsed) cv.experiences.push(parsed);
        }
        break;
      case 'projects':
        for (const block of blocksOf(section.lines)) {
          const parsed = parseProject(block);
          if (parsed) cv.projects.push(parsed);
        }
        break;
      case 'education':
        for (const block of blocksOf(section.lines)) {
          const parsed = parseEducation(block);
          if (parsed) cv.education.push(parsed);
        }
        break;
      case 'skills':
        cv.skills.push(...parseSkills(section.lines));
        break;
      case 'languages':
        cv.languages.push(
          ...bulletsOf(section.lines),
          ...plainLines(section.lines).map(stripInline),
        );
        break;
      case 'courses':
        cv.courses.push(...bulletsOf(section.lines), ...plainLines(section.lines).map(stripInline));
        break;
      default:
        break;
    }
  }
  return cv;
}
