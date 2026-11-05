import type {
  ResumeBodySection,
  ResumeBullet,
  ResumeContent,
  ResumeEntry,
  ResumeIssue,
} from '@chameleon/contracts';

/** Funcoes puras de edicao do documento do curriculo (sempre devolvem uma copia). */

const replaceAt = <T>(items: readonly T[], index: number, change: (item: T) => T): T[] =>
  items.map((item, n) => (n === index ? change(item) : item));

const removeAt = <T>(items: readonly T[], index: number): T[] =>
  items.filter((_, n) => n !== index);

export function patchHeader(
  content: ResumeContent,
  patch: Partial<Pick<ResumeContent['header'], 'name' | 'headline' | 'location'>>,
): ResumeContent {
  return { ...content, header: { ...content.header, ...patch } };
}

export function removeContact(content: ResumeContent, n: number): ResumeContent {
  return {
    ...content,
    header: { ...content.header, contacts: removeAt(content.header.contacts, n) },
  };
}

export function patchSection(
  content: ResumeContent,
  s: number,
  patch: Partial<Pick<ResumeBodySection, 'title'>>,
): ResumeContent {
  return {
    ...content,
    sections: replaceAt(content.sections, s, (section) => ({ ...section, ...patch })),
  };
}

export function removeSection(content: ResumeContent, s: number): ResumeContent {
  return { ...content, sections: removeAt(content.sections, s) };
}

function changeEntries(
  content: ResumeContent,
  s: number,
  change: (entries: ResumeEntry[]) => ResumeEntry[],
): ResumeContent {
  return {
    ...content,
    sections: replaceAt(content.sections, s, (section) => ({
      ...section,
      entries: change(section.entries),
    })),
  };
}

export function patchEntry(
  content: ResumeContent,
  s: number,
  e: number,
  patch: Partial<Pick<ResumeEntry, 'heading' | 'subheading' | 'period'>>,
): ResumeContent {
  return changeEntries(content, s, (entries) =>
    replaceAt(entries, e, (entry) => ({ ...entry, ...patch })),
  );
}

export function removeEntry(content: ResumeContent, s: number, e: number): ResumeContent {
  return changeEntries(content, s, (entries) => removeAt(entries, e));
}

function changeBullets(
  content: ResumeContent,
  s: number,
  e: number,
  change: (bullets: ResumeBullet[]) => ResumeBullet[],
): ResumeContent {
  return changeEntries(content, s, (entries) =>
    replaceAt(entries, e, (entry) => ({ ...entry, bullets: change(entry.bullets) })),
  );
}

export function patchBulletText(
  content: ResumeContent,
  s: number,
  e: number,
  b: number,
  text: string,
): ResumeContent {
  return changeBullets(content, s, e, (bullets) =>
    replaceAt(bullets, b, (bullet) => ({ ...bullet, text })),
  );
}

export function removeBullet(content: ResumeContent, s: number, e: number, b: number) {
  return changeBullets(content, s, e, (bullets) => removeAt(bullets, b));
}

/** Id aceito pelo contrato (`^[a-z0-9][a-z0-9-]{0,39}$`), unico o bastante para um uso pessoal. */
export function newBulletId(): string {
  return `n-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Novo item vazio: origem `added`, com as mesmas fontes da entrada (a pessoa pode conferir e ajustar). */
export function addBullet(content: ResumeContent, s: number, e: number): ResumeContent {
  return changeEntries(content, s, (entries) =>
    replaceAt(entries, e, (entry) => ({
      ...entry,
      bullets: [
        ...entry.bullets,
        { id: newBulletId(), text: '', sourceIds: [...entry.sourceIds], origin: 'added' as const },
      ],
    })),
  );
}

/**
 * Origem exibida: espelha a regra do servidor (texto alterado deixa de ser "gerado"; id novo e
 * "adicionado"). O servidor decide a origem de fato ao salvar.
 */
export function displayOrigin(
  bullet: ResumeBullet,
  saved: ReadonlyMap<string, ResumeBullet>,
): ResumeBullet['origin'] {
  const before = saved.get(bullet.id);
  if (before === undefined) return 'added';
  if (before.text !== bullet.text) return before.origin === 'added' ? 'added' : 'edited';
  return before.origin;
}

export function bulletsById(content: ResumeContent): Map<string, ResumeBullet> {
  return new Map(
    content.sections.flatMap((section) =>
      section.entries.flatMap((entry) =>
        entry.bullets.map((bullet) => [bullet.id, bullet] as const),
      ),
    ),
  );
}

export function issuesByPath(issues: readonly ResumeIssue[]): Map<string, ResumeIssue[]> {
  const map = new Map<string, ResumeIssue[]>();
  for (const issue of issues) map.set(issue.path, [...(map.get(issue.path) ?? []), issue]);
  return map;
}

export function issueCounts(issues: readonly ResumeIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  };
}

export const warningSignature = (issues: readonly ResumeIssue[]): string =>
  JSON.stringify(
    issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => [issue.path, issue.message]),
  );

/** Mensagem em portugues para um problema de validacao local (zod) de um campo. */
export function fieldMessage(issue: { code: string; message: string; maximum?: unknown }): string {
  if (issue.message.startsWith('Too small')) return 'Preencha este campo.';
  if (issue.message.startsWith('Too big')) {
    return typeof issue.maximum === 'number' || typeof issue.maximum === 'bigint'
      ? `Use até ${String(issue.maximum)} caracteres.`
      : 'O texto é longo demais.';
  }
  if (issue.message.startsWith('Invalid')) return 'Valor inválido.';
  return issue.message;
}

/** Erros de validacao local (zod) por caminho do campo, so o primeiro de cada campo. */
export function errorsByPath(
  issues: readonly {
    path: readonly PropertyKey[];
    code: string;
    message: string;
    maximum?: unknown;
  }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const issue of issues) {
    const key = issue.path.map(String).join('.');
    if (!map.has(key)) map.set(key, fieldMessage(issue));
  }
  return map;
}

/** Descreve em palavras onde fica um caminho como `sections.1.entries.0.bullets.2`. */
export function locationLabel(content: ResumeContent, path: string): string {
  const parts = path.split('.');
  const at = (i: number): number => Number(parts[i]);
  if (parts[0] === 'header') {
    return parts[1] === 'contacts' ? `Contato ${String(at(2) + 1)}` : 'Cabeçalho';
  }
  if (parts[0] !== 'sections') return 'Currículo';
  if (parts.length === 1) return 'Seções';
  const section = content.sections[at(1)];
  let text = `Seção "${section?.title ?? '?'}"`;
  if (parts[2] === 'entries') {
    text += `, entrada "${section?.entries[at(3)]?.heading ?? '?'}"`;
    if (parts[4] === 'bullets') text += `, item ${String(at(5) + 1)}`;
  }
  return text;
}
