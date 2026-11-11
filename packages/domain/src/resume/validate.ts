import type { KeywordCoverage, ResumeContent, ResumeIssue } from '@chameleon/contracts';
import { parseBaseCv } from '../cv/parse';
import { avoidedExpressions } from '../profile/rules';
import { containsTerm, fold } from '../text/fold';
import { findExperience, resumeText } from './build';

/**
 * Fact checks of a resume against the professional base, ported from career-ops (`verify-cv-facts`,
 * `cv-title-check`, `verify-cv-structure`, `keyword-match`). They are deliberately simple and explainable: each
 * issue names the place and the term, never rewrites anything. Errors block approval; warnings ask for a look.
 */

export interface ValidationSources {
  cvMarkdown: string;
  profileMarkdown: string;
  /** Keywords of the job evaluation (to flag a job keyword the base does not support). */
  keywords?: readonly string[];
}

/** Numbers and metrics: `192`, `66`, `3,5`, `40%`, `05/11/2026`, `2023`. */
const NUMBER = /\d+(?:[.,/:]\d+)*%?/g;

/**
 * Seniority words a junior profile must not claim unless the base itself uses them. Each one is checked on its own
 * (a base saying "Tech Lead" licenses "Lead", not "Sênior").
 */
const SENIORITY =
  /\b(s[eê]nior|pleno|especialista|specialist|l[ií]der|lead|staff|head|gerente|manager|coordenador(?:a)?|diretor(?:a)?)\b/gi;

/**
 * Tool-shaped tokens: `.NET`, `Node.js`, `C#`, `C++`, `AWS`, `SQL`, `TypeScript`, `GitHub`. A capital letter at the
 * start of a sentence is not enough: the shape needs a dot or `#`/`+` inside, all capitals, or an inner capital.
 */
const TOOL_TOKEN =
  /(?:^|[\s(,;/])(\.[A-Za-z]+|[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+|[A-Za-z][A-Za-z0-9]*[#+]+|[A-Z]{2,}[0-9]*|[A-Za-z]*[a-z][A-Z][A-Za-z0-9]*)(?=$|[\s),;/.:])/g;

/** Uppercase words that are ordinary text, not tools. */
const NOT_TOOLS = new Set([
  'SP',
  'RJ',
  'MG',
  'BR',
  'CLT',
  'PJ',
  'TI',
  'IT',
  'CV',
  'EUA',
  'USA',
  'UK',
  'LTDA',
  'S.A.',
  'ME',
  'OK',
]);

interface Place {
  path: string;
  text: string;
}

function placesOf(content: ResumeContent): Place[] {
  const places: Place[] = [{ path: 'header.headline', text: content.header.headline ?? '' }];
  content.sections.forEach((section, s) => {
    section.entries.forEach((entry, e) => {
      const base = `sections.${String(s)}.entries.${String(e)}`;
      places.push({ path: `${base}.heading`, text: entry.heading });
      if (entry.subheading) places.push({ path: `${base}.subheading`, text: entry.subheading });
      if (entry.detail) places.push({ path: `${base}.detail`, text: entry.detail });
      entry.bullets.forEach((bullet, b) => {
        places.push({ path: `${base}.bullets.${String(b)}`, text: bullet.text });
      });
    });
  });
  return places.filter((place) => place.text.trim() !== '');
}

const digitsOf = (value: string): string => value.replace(/[^0-9]/g, '');

export function validateResume(content: ResumeContent, sources: ValidationSources): ResumeIssue[] {
  const issues: ResumeIssue[] = [];
  const push = (issue: ResumeIssue): void => {
    if (issues.length < 200) issues.push(issue);
  };
  const baseFolded = fold(`${sources.cvMarkdown}\n${sources.profileMarkdown}`);
  const cvFolded = fold(sources.cvMarkdown);
  const baseDigits = new Set(
    (sources.cvMarkdown + '\n' + sources.profileMarkdown).match(NUMBER) ?? [],
  );
  const baseNumberDigits = new Set([...baseDigits].map(digitsOf));
  const base = parseBaseCv(sources.cvMarkdown);
  const avoid = avoidedExpressions(sources.profileMarkdown);
  const places = placesOf(content);

  // Structure.
  const seen = new Set<string>();
  for (const [s, section] of content.sections.entries()) {
    for (const id of [
      section.id,
      ...section.entries.flatMap((entry) => [entry.id, ...entry.bullets.map((b) => b.id)]),
    ]) {
      if (seen.has(id)) {
        push({
          severity: 'error',
          code: 'DUPLICATE_ID',
          path: `sections.${String(s)}`,
          message: `Id repetido: ${id}.`,
        });
      }
      seen.add(id);
    }
  }
  if (content.sections.every((section) => section.entries.length === 0)) {
    push({
      severity: 'error',
      code: 'EMPTY_CONTENT',
      path: 'sections',
      message: 'O currículo não tem nenhuma entrada.',
    });
  }

  for (const place of places) {
    // Numbers: every figure must appear in the base (career-ops fact gate).
    for (const number of place.text.match(NUMBER) ?? []) {
      const plain = number.replace(/%$/, '');
      if (baseDigits.has(number) || baseDigits.has(plain) || baseNumberDigits.has(digitsOf(plain)))
        continue;
      push({
        severity: 'error',
        code: 'UNSUPPORTED_NUMBER',
        path: place.path,
        message: `O número "${number}" não aparece na base profissional.`,
      });
    }
    // Seniority words the base does not use.
    for (const match of place.text.matchAll(SENIORITY)) {
      const word = match[1] ?? match[0];
      if (containsTerm(cvFolded, word)) continue;
      push({
        severity: 'error',
        code: 'SENIORITY_CLAIM',
        path: place.path,
        message: `"${word}" indica uma senioridade que a base não sustenta.`,
      });
    }
    // Expressions the profile says to avoid.
    const folded = fold(place.text);
    for (const expression of avoid) {
      if (containsTerm(folded, expression)) {
        push({
          severity: 'error',
          code: 'FORBIDDEN_PHRASE',
          path: place.path,
          message: `"${expression}" está na lista de expressões a evitar do seu perfil.`,
        });
      }
    }
    // Tool-shaped tokens the base never mentions.
    for (const match of place.text.matchAll(TOOL_TOKEN)) {
      const token = (match[1] ?? '').replace(/[.:]+$/, '');
      if (token.length < 2 || NOT_TOOLS.has(token) || /^\d/.test(token)) continue;
      if (containsTerm(baseFolded, token)) continue;
      push({
        severity: 'warning',
        code: 'UNSUPPORTED_TERM',
        path: place.path,
        message: `"${token}" não aparece na base profissional: confira se você tem essa experiência.`,
      });
    }
  }

  // Job keywords that made it into the resume but are not in the base: flagged where they appear.
  for (const keyword of sources.keywords ?? []) {
    if (containsTerm(baseFolded, keyword)) continue;
    for (const place of places) {
      if (!containsTerm(fold(place.text), keyword)) continue;
      const already = issues.some(
        (issue) =>
          issue.code === 'UNSUPPORTED_TERM' &&
          issue.path === place.path &&
          fold(issue.message).includes(fold(keyword)),
      );
      if (already) continue;
      push({
        severity: 'warning',
        code: 'UNSUPPORTED_TERM',
        path: place.path,
        message: `"${keyword}" (palavra-chave da vaga) não aparece na base profissional: confira se você tem essa experiência.`,
      });
    }
  }

  // Titles and order of the experiences (career-ops cv-title-check / verify-cv-structure).
  let lastIndex = -1;
  let orderReported = false;
  content.sections.forEach((section, s) => {
    if (section.kind !== 'experience') return;
    section.entries.forEach((entry, e) => {
      const company = entry.subheading?.split(' · ')[0] ?? entry.heading;
      const at = findExperience(base.experiences, company);
      const path = `sections.${String(s)}.entries.${String(e)}`;
      if (at === -1) {
        push({
          severity: 'warning',
          code: 'UNKNOWN_EXPERIENCE',
          path,
          message: `"${company}" não está entre as experiências da base.`,
        });
        return;
      }
      const expected = base.experiences[at]?.title ?? null;
      if (expected !== null && fold(entry.heading) !== fold(expected)) {
        push({
          severity: 'error',
          code: 'TITLE_MISMATCH',
          path: `${path}.heading`,
          message: `O cargo nesta empresa é "${expected}" na base; o currículo diz "${entry.heading}".`,
        });
      }
      if (at < lastIndex && !orderReported) {
        orderReported = true;
        push({
          severity: 'warning',
          code: 'EXPERIENCE_ORDER',
          path,
          message: 'As experiências estão fora da ordem da base (mais recente primeiro).',
        });
      }
      lastIndex = Math.max(lastIndex, at);
    });
  });

  return issues;
}

/** Share of the job keywords present in the resume (career-ops keyword-match). */
export function keywordCoverage(
  content: ResumeContent,
  keywords: readonly string[],
): KeywordCoverage | null {
  const unique = [...new Map(keywords.map((k) => [fold(k), k.trim()])).values()].filter(
    (k) => k !== '',
  );
  if (unique.length === 0) return null;
  const folded = fold(resumeText(content));
  const present = unique.filter((keyword) => containsTerm(folded, keyword));
  const missing = unique.filter((keyword) => !present.includes(keyword));
  return {
    percent: Math.round((present.length / unique.length) * 100),
    present: present.slice(0, 40),
    missing: missing.slice(0, 40),
  };
}
