import type { ProfileDocument, ResumeContent, ResumeIssue } from '@chameleon/contracts';
import { extractKeywords } from '../matching/requirements';
import { buildMatchIndex, type IndexedFact } from '../matching/profile-index';
import { tokenize } from '../matching/text';

/**
 * Factuality check of a resume against the profile snapshot it was generated from:
 *  - every entry and bullet has sources, every source exists in the snapshot and is still usable
 *    (confirmed, allowed in resumes, not private) -> errors that block approval;
 *  - text that the owner edited or added, and entry headings, must not bring numbers or technology-like terms
 *    that the sources do not contain -> warnings to review (a person can legitimately rephrase).
 */

const NUMBER = /\d[\d.,]*%?/g;

export function unsupportedIn(text: string, sources: readonly IndexedFact[]): string[] {
  if (sources.length === 0) return [];
  const haystack = sources.map((source) => source.haystack).join(' ');
  const terms = [...(text.match(NUMBER) ?? []), ...extractKeywords(text)];
  const missing: string[] = [];
  for (const term of terms) {
    const tokens = tokenize(term).join(' ');
    if (tokens === '' || missing.includes(term)) continue;
    if (!haystack.includes(` ${tokens} `) && !haystack.includes(tokens)) missing.push(term);
  }
  return missing.slice(0, 5);
}

function headingMissing(text: string, sources: readonly IndexedFact[]): string[] {
  if (sources.length === 0) return [];
  const haystack = sources.map((source) => source.haystack).join(' ');
  return tokenize(text)
    .filter((token) => token.length >= 3 && !haystack.includes(` ${token} `))
    .slice(0, 5);
}

export function validateResume(content: ResumeContent, document: ProfileDocument): ResumeIssue[] {
  const index = buildMatchIndex(document);
  const issues: ResumeIssue[] = [];
  const push = (issue: ResumeIssue): void => {
    if (issues.length < 200) issues.push(issue);
  };

  const sourcesOf = (path: string, sourceIds: readonly string[], what: string): IndexedFact[] => {
    const found: IndexedFact[] = [];
    if (sourceIds.length === 0) {
      push({
        severity: 'error',
        code: 'NO_SOURCE',
        path,
        message: `${what} não tem nenhum registro do perfil que o sustente.`,
      });
    }
    for (const sourceId of sourceIds) {
      const fact = index.byId.get(sourceId.toLowerCase());
      if (fact === undefined) {
        push({
          severity: 'error',
          code: 'UNKNOWN_SOURCE',
          path,
          message: `${what} aponta para um registro que não existe no perfil usado na geração.`,
        });
      } else if (!fact.usable) {
        push({
          severity: 'error',
          code: 'SOURCE_NOT_USABLE',
          path,
          message: `${what} depende de um registro que não está confirmado ou não pode ser usado em currículos.`,
        });
      } else {
        found.push(fact);
      }
    }
    return found;
  };

  const seen = new Set<string>();
  const unique = (id: string, path: string): void => {
    if (seen.has(id)) {
      push({
        severity: 'error',
        code: 'DUPLICATE_ID',
        path,
        message: `O id "${id}" está repetido.`,
      });
    }
    seen.add(id);
  };

  content.header.contacts.forEach((contact, n) => {
    const path = `header.contacts.${String(n)}`;
    const fact = index.byId.get(contact.sourceId.toLowerCase());
    if (fact?.kind !== 'contact_point') {
      push({
        severity: 'error',
        code: 'UNKNOWN_SOURCE',
        path,
        message: 'O contato não existe no perfil usado na geração.',
      });
    } else if (fact.value.visibility !== 'public') {
      push({
        severity: 'error',
        code: 'SOURCE_NOT_USABLE',
        path,
        message: 'Este contato não está marcado como público no perfil.',
      });
    }
  });

  let entryCount = 0;
  content.sections.forEach((section, s) => {
    unique(`section:${section.id}`, `sections.${String(s)}`);
    section.entries.forEach((entry, e) => {
      entryCount += 1;
      const entryPath = `sections.${String(s)}.entries.${String(e)}`;
      unique(`entry:${entry.id}`, entryPath);
      const entrySources = sourcesOf(entryPath, entry.sourceIds, 'A entrada');
      if (
        section.kind !== 'summary' &&
        section.kind !== 'skills' &&
        section.kind !== 'competencies'
      ) {
        const missing = headingMissing(
          [entry.heading, entry.subheading ?? '', entry.detail ?? ''].join(' '),
          entrySources,
        );
        if (missing.length > 0) {
          push({
            severity: 'warning',
            code: 'UNSUPPORTED_TERM',
            path: entryPath,
            message: `O cabeçalho tem palavras que não aparecem nos registros de origem: ${missing.join(', ')}.`,
          });
        }
      }
      entry.bullets.forEach((bullet, b) => {
        const path = `${entryPath}.bullets.${String(b)}`;
        unique(`bullet:${bullet.id}`, path);
        const sources = sourcesOf(path, bullet.sourceIds, 'O item');
        if (bullet.origin !== 'generated') {
          const missing = unsupportedIn(bullet.text, sources);
          if (missing.length > 0) {
            push({
              severity: 'warning',
              code: 'UNSUPPORTED_TERM',
              path,
              message: `O texto menciona termos ou números que não aparecem nos registros de origem: ${missing.join(', ')}.`,
            });
          }
        }
      });
    });
  });

  if (entryCount === 0) {
    push({
      severity: 'error',
      code: 'EMPTY_CONTENT',
      path: 'sections',
      message: 'O currículo não tem nenhuma entrada.',
    });
  }
  return issues;
}

/** Marks edited text: a bullet whose text changed keeps its id but can no longer claim to be `generated`. */
export function reconcileOrigins(previous: ResumeContent, next: ResumeContent): ResumeContent {
  const before = new Map<string, { text: string; origin: string }>();
  for (const section of previous.sections) {
    for (const entry of section.entries) {
      for (const bullet of entry.bullets) before.set(bullet.id, bullet);
    }
  }
  return {
    ...next,
    sections: next.sections.map((section) => ({
      ...section,
      entries: section.entries.map((entry) => ({
        ...entry,
        bullets: entry.bullets.map((bullet) => {
          const old = before.get(bullet.id);
          if (old === undefined) return { ...bullet, origin: 'added' as const };
          if (old.text !== bullet.text) {
            return {
              ...bullet,
              origin: old.origin === 'added' ? ('added' as const) : ('edited' as const),
            };
          }
          return { ...bullet, origin: old.origin as typeof bullet.origin };
        }),
      })),
    })),
  };
}
