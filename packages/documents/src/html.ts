import type { RenderContact, RenderModel } from './render-model';

/** Escapes text for HTML element content and attribute values. Resume content is DATA, never markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CSS = `
  @page { size: var(--paper); margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Arimo, "Liberation Sans", Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.35; color: #111; margin: 0; }
  h1 { font-size: 20pt; margin: 0 0 2pt; }
  .headline { font-size: 11.5pt; margin: 0 0 2pt; }
  .meta { margin: 0 0 8pt; color: #333; }
  h2 { font-size: 12pt; margin: 12pt 0 4pt; padding-bottom: 2pt; border-bottom: 0.75pt solid #444; letter-spacing: 0.02em; }
  .entry { margin: 0 0 6pt; break-inside: avoid-page; }
  .entry-head { display: flex; justify-content: space-between; gap: 12pt; font-weight: bold; }
  .period { font-weight: normal; white-space: nowrap; }
  .sub { margin: 0; }
  ul { margin: 2pt 0 0; padding-left: 14pt; }
  li { margin: 0 0 1.5pt; }
  p { margin: 0 0 4pt; }
  a { color: inherit; text-decoration: none; }
`;

function contactHtml(contact: RenderContact): string {
  const text = escapeHtml(contact.text);
  return contact.href === null ? text : `<a href="${escapeHtml(contact.href)}">${text}</a>`;
}

/**
 * Single-column, selectable-text HTML printed to PDF. No script, no external resources, no layout tables.
 * Every dynamic value goes through `escapeHtml`.
 */
export function renderHtml(model: RenderModel): string {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(model.name)}</h1>`);
  if (model.headline !== null) parts.push(`<p class="headline">${escapeHtml(model.headline)}</p>`);
  const meta = [
    ...(model.location !== null ? [escapeHtml(model.location)] : []),
    ...model.contacts.map(contactHtml),
  ];
  if (meta.length > 0) parts.push(`<p class="meta">${meta.join(' · ')}</p>`);

  for (const section of model.sections) {
    parts.push(`<section><h2>${escapeHtml(section.title)}</h2>`);
    for (const paragraph of section.paragraphs) parts.push(`<p>${escapeHtml(paragraph)}</p>`);
    for (const entry of section.entries) {
      parts.push('<div class="entry">');
      parts.push(
        `<div class="entry-head"><span>${escapeHtml(entry.heading)}</span>${
          entry.period !== null ? `<span class="period">${escapeHtml(entry.period)}</span>` : ''
        }</div>`,
      );
      if (entry.subheading !== null)
        parts.push(`<p class="sub">${escapeHtml(entry.subheading)}</p>`);
      if (entry.bullets.length > 0) {
        parts.push(`<ul>${entry.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
      }
      parts.push('</div>');
    }
    parts.push('</section>');
  }

  const paper = model.paper === 'Letter' ? 'Letter' : 'A4';
  const lang = /^[a-zA-Z-]{2,12}$/.test(model.language) ? model.language : 'pt-BR';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(model.name)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>:root { --paper: ${paper}; }${CSS}</style>
</head>
<body>
${parts.join('\n')}
</body>
</html>`;
}
