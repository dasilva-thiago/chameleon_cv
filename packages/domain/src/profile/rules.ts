/**
 * The few things the program itself reads from the "Perfil e regras" Markdown. Everything else in that text is
 * guidance for the AI. Conventions (any heading level, Portuguese or English):
 *
 *     ## Expressões a evitar        (or "Avoid", "Nunca usar", "Proibido")
 *     - especialista
 *     - "ampla experiência"
 *
 *     **Idioma do currículo:** pt-BR
 */

const AVOID_HEADING = /^#{1,6}\s+.*(evitar|avoid|proibid|nunca usar|never use)/i;
const ANY_HEADING = /^#{1,6}\s+/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const LANGUAGE_LINE =
  /(?:idioma do curr[ií]culo|idioma de sa[ií]da|resume language|output language)\s*:?\**\s*:?\s*([a-z]{2,3}(?:-[A-Za-z]{2,4})?)/i;

function unquote(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/^["'“”‘’`]+|["'“”‘’`.;]+$/g, '')
    .trim();
}

/** Expressions listed under an "avoid" heading. */
export function avoidedExpressions(profileMarkdown: string): string[] {
  const found: string[] = [];
  let inside = false;
  for (const line of profileMarkdown.replace(/\r\n?/g, '\n').split('\n')) {
    if (ANY_HEADING.test(line)) {
      inside = AVOID_HEADING.test(line);
      continue;
    }
    if (!inside) continue;
    const bullet = BULLET.exec(line);
    if (!bullet) continue;
    const value = unquote(bullet[1] ?? '');
    if (value.length >= 2 && value.length <= 80) found.push(value);
  }
  return [...new Set(found)].slice(0, 60);
}

/** Resume language declared in the profile (`pt-BR` when absent). */
export function resumeLanguage(profileMarkdown: string): string {
  const match = LANGUAGE_LINE.exec(profileMarkdown);
  const value = match?.[1];
  if (value === undefined) return 'pt-BR';
  const [lang, region] = value.split('-');
  return region
    ? `${(lang ?? '').toLowerCase()}-${region.toUpperCase()}`
    : (lang ?? 'pt').toLowerCase();
}
