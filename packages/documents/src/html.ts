import type { ResumeExportTemplate } from '@chameleon/contracts';
import { skillGroupLine, type RenderContact, type RenderModel } from './render-model';

/** Escapes text for HTML element content and attribute values. Resume content is DATA, never markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------------------------------------
// Classic template: the original single-column layout.

const CLASSIC_CSS = `
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
  .detail { margin: 0; color: #444; }
  ul { margin: 2pt 0 0; padding-left: 14pt; }
  li { margin: 0 0 1.5pt; }
  p { margin: 0 0 4pt; }
  a { color: inherit; text-decoration: none; }
`;

function classicContact(contact: RenderContact): string {
  const text = escapeHtml(contact.text);
  return contact.href === null ? text : `<a href="${escapeHtml(contact.href)}">${text}</a>`;
}

function classicBody(model: RenderModel): string {
  const parts: string[] = [];
  parts.push(`<h1>${escapeHtml(model.name)}</h1>`);
  if (model.headline !== null) parts.push(`<p class="headline">${escapeHtml(model.headline)}</p>`);
  const meta = [
    ...(model.location !== null ? [escapeHtml(model.location)] : []),
    ...model.contacts.map(classicContact),
  ];
  if (meta.length > 0) parts.push(`<p class="meta">${meta.join(' · ')}</p>`);

  for (const section of model.sections) {
    parts.push(`<section><h2>${escapeHtml(section.title)}</h2>`);
    for (const paragraph of section.paragraphs) parts.push(`<p>${escapeHtml(paragraph)}</p>`);
    if (section.tags.length > 0) parts.push(`<p>${escapeHtml(section.tags.join(' · '))}</p>`);
    for (const group of section.groups) parts.push(`<p>${escapeHtml(skillGroupLine(group))}</p>`);
    for (const entry of section.entries) {
      parts.push('<div class="entry">');
      parts.push(
        `<div class="entry-head"><span>${escapeHtml(entry.heading)}</span>${
          entry.period !== null ? `<span class="period">${escapeHtml(entry.period)}</span>` : ''
        }</div>`,
      );
      if (entry.subheading !== null)
        parts.push(`<p class="sub">${escapeHtml(entry.subheading)}</p>`);
      if (entry.detail !== null) parts.push(`<p class="detail">${escapeHtml(entry.detail)}</p>`);
      if (entry.bullets.length > 0) {
        parts.push(`<ul>${entry.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
      }
      parts.push('</div>');
    }
    parts.push('</section>');
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// Modern template: header with accent title and gradient rule, key-skill tags, company/role/period rows, project
// and course layouts. Follows the layout and values of the reference CVs (career-ops/output/*.html).

const MODERN_CSS = `
  :root {
    --accent-color: hsl(187 74% 32%);
    --secondary-color: hsl(270, 70%, 45%);
    --tag-color: hsl(187, 74%, 28%);
    --tag-bg: hsl(187, 40%, 95%);
    --tag-border: hsl(187, 40%, 88%);
    --font-family: "Liberation Sans", 'Helvetica Neue', Arial, 'DejaVu Sans', sans-serif;
    --font-size: 11px;
    --page-margin: 0.6in;
  }
  @page { size: var(--paper); margin: var(--page-margin); }
  * {
    margin: 0; padding: 0; box-sizing: border-box;
    font-variant-ligatures: none;
    font-feature-settings: "liga" 0, "clig" 0, "dlig" 0;
  }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: var(--font-family); font-size: var(--font-size); line-height: 1.5; color: #1a1a2e; background: #ffffff; }
  @media screen { body { padding: 24px 16px; } }
  .page { width: 100%; max-width: 210mm; margin: 0 auto; padding: 2px 0; }
  a { white-space: nowrap; }

  .header { margin-bottom: 20px; }
  .header h1 { font-size: 28px; font-weight: 700; color: #1a1a2e; letter-spacing: -0.02em; margin-bottom: 6px; line-height: 1.1; }
  .header-title { font-size: 16px; font-weight: 600; color: var(--accent-color); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; line-height: 1.2; }
  .header-gradient { height: 2px; background: linear-gradient(to right, var(--accent-color), var(--secondary-color)); border-radius: 1px; margin-bottom: 10px; }
  .contact-row { display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 10.5px; line-height: 1.4; color: #555; }
  .contact-row a { color: #555; text-decoration: none; }
  .contact-row > *:not(:last-child)::after { content: "|"; color: #ccc; margin-inline-start: 14px; }

  .section { margin-bottom: 18px; }
  .section-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent-color); border-bottom: 1.5px solid #e2e2e2; padding-bottom: 4px; margin-bottom: 10px; line-height: 1.2; }
  .summary-text { font-size: var(--font-size); line-height: 1.7; color: #2f2f2f; }

  .competencies-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .competency-tag { font-size: 10px; font-weight: 500; color: var(--tag-color); background: var(--tag-bg); padding: 4px 10px; border-radius: 3px; border: 1px solid var(--tag-border); }

  .job { margin-bottom: 14px; }
  .job-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 4px; }
  .job-company { font-size: 12.5px; font-weight: 600; color: var(--secondary-color); }
  .job-period { font-size: 10.5px; color: #777; white-space: nowrap; }
  .job-role { font-size: var(--font-size); font-weight: 600; color: #333; margin-bottom: 6px; }
  .job-location { font-size: 10px; color: #888; }
  .job ul { padding-left: 18px; margin-top: 6px; }
  .job li { font-size: 10.5px; line-height: 1.6; color: #333; margin-bottom: 4px; }

  .project { margin-bottom: 12px; }
  .project-title { font-size: 11.5px; font-weight: 600; color: var(--secondary-color); }
  .project-title a { color: inherit; text-decoration: none; }
  .project-badge { font-size: 9px; font-weight: 500; color: var(--accent-color); background: var(--tag-bg); padding: 1px 6px; border-radius: 2px; margin-left: 6px; }
  .project-desc { font-size: 10.5px; color: #444; margin-top: 3px; line-height: 1.55; }
  .project-tech { font-size: 9.5px; color: #888; margin-top: 3px; }

  .edu-item { margin-bottom: 8px; }
  .edu-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .edu-title { font-weight: 600; font-size: var(--font-size); color: #333; }
  .edu-org { color: var(--secondary-color); font-weight: 500; }
  .edu-year { font-size: 10px; color: #777; white-space: nowrap; }
  .edu-location { font-size: 10px; color: #888; }

  .cert-table { display: table; width: 100%; }
  .cert-item { display: table-row; }
  .cert-item > * { display: table-cell; vertical-align: baseline; padding-bottom: 6px; }
  .cert-title { font-size: 10.5px; font-weight: 500; color: #333; }
  .cert-org { color: var(--secondary-color); white-space: nowrap; }
  .cert-year { font-size: 10px; color: #777; white-space: nowrap; text-align: right; width: 44px; }

  .skills-grid { display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .skill-item { font-size: 10.5px; color: #444; }
  .skill-category { font-weight: 600; color: #333; font-size: 10.5px; }

  @media print { .page { padding: 0 0.18in 0 0; max-width: none; } }
  .header, .edu-item, .cert-item, .competency-tag, .skill-item { break-inside: avoid; page-break-inside: avoid; }
`;

function modernContact(contact: RenderContact): string {
  const text = escapeHtml(contact.display);
  return contact.href === null
    ? `<span>${text}</span>`
    : `<a href="${escapeHtml(contact.href)}">${text}</a>`;
}

function modernBody(model: RenderModel): string {
  const out: string[] = ['<div class="page">'];
  out.push('<div class="header">', `<h1>${escapeHtml(model.name)}</h1>`);
  if (model.headline !== null) {
    out.push(`<div class="header-title">${escapeHtml(model.headline)}</div>`);
  }
  out.push('<div class="header-gradient"></div>');
  const contacts = [
    ...model.contacts.map(modernContact),
    ...(model.location !== null ? [`<span>${escapeHtml(model.location)}</span>`] : []),
  ];
  if (contacts.length > 0) out.push(`<div class="contact-row">${contacts.join('')}</div>`);
  out.push('</div>');

  for (const section of model.sections) {
    out.push(
      '<div class="section">',
      `<h2 class="section-title">${escapeHtml(section.title)}</h2>`,
    );
    for (const paragraph of section.paragraphs) {
      out.push(`<div class="summary-text">${escapeHtml(paragraph)}</div>`);
    }
    if (section.tags.length > 0) {
      out.push(
        `<div class="competencies-grid">${section.tags
          .map((tag) => `<span class="competency-tag">${escapeHtml(tag)}</span>`)
          .join('')}</div>`,
      );
    }
    if (section.groups.length > 0) {
      out.push(
        `<div class="skills-grid">${section.groups
          .map(
            (group) =>
              `<div class="skill-item"><span class="skill-category">${escapeHtml(group.label)}: </span>${escapeHtml(group.items.join(', '))}</div>`,
          )
          .join('')}</div>`,
      );
    }

    if (section.kind === 'experience') {
      for (const entry of section.entries) {
        const company = entry.subheading ?? entry.heading;
        out.push(
          '<div class="job">',
          `<div class="job-header"><span class="job-company">${escapeHtml(company)}</span>${
            entry.period !== null
              ? `<span class="job-period">${escapeHtml(entry.period)}</span>`
              : ''
          }</div>`,
        );
        if (entry.subheading !== null) {
          out.push(`<div class="job-role">${escapeHtml(entry.heading)}</div>`);
        }
        if (entry.detail !== null) {
          out.push(`<div class="job-location">${escapeHtml(entry.detail)}</div>`);
        }
        if (entry.bullets.length > 0) {
          out.push(`<ul>${entry.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`);
        }
        out.push('</div>');
      }
    } else if (section.kind === 'projects') {
      for (const entry of section.entries) {
        const title =
          entry.url !== null
            ? `<a href="${escapeHtml(entry.url)}">${escapeHtml(entry.heading)}</a>`
            : escapeHtml(entry.heading);
        out.push(
          '<div class="project">',
          `<div class="project-title">${title}${
            entry.subheading !== null
              ? `<span class="project-badge">${escapeHtml(entry.subheading)}</span>`
              : ''
          }</div>`,
        );
        for (const bullet of entry.bullets) {
          out.push(`<div class="project-desc">${escapeHtml(bullet)}</div>`);
        }
        if (entry.detail !== null) {
          out.push(`<div class="project-tech">${escapeHtml(entry.detail)}</div>`);
        }
        out.push('</div>');
      }
    } else if (section.kind === 'education') {
      for (const entry of section.entries) {
        out.push(
          '<div class="edu-item">',
          `<div class="edu-header"><div class="edu-title">${escapeHtml(entry.heading)}${
            entry.subheading !== null
              ? ` <span class="edu-org">${escapeHtml(entry.subheading)}</span>`
              : ''
          }</div>${
            entry.period !== null ? `<div class="edu-year">${escapeHtml(entry.period)}</div>` : ''
          }</div>`,
        );
        if (entry.detail !== null) {
          out.push(`<div class="edu-location">${escapeHtml(entry.detail)}</div>`);
        }
        out.push('</div>');
      }
    } else if (section.kind === 'certifications') {
      out.push('<div class="cert-table">');
      for (const entry of section.entries) {
        out.push(
          `<div class="cert-item"><span class="cert-title">${escapeHtml(entry.heading)}</span><span class="cert-org">${
            entry.subheading !== null ? escapeHtml(entry.subheading) : ''
          }</span><span class="cert-year">${
            entry.period !== null ? escapeHtml(entry.period) : ''
          }</span></div>`,
        );
      }
      out.push('</div>');
    } else if (section.kind === 'languages') {
      out.push(
        `<div class="skills-grid">${section.entries
          .map((entry) =>
            entry.subheading !== null
              ? `<div class="skill-item"><span class="skill-category">${escapeHtml(entry.heading)}: </span>${escapeHtml(entry.subheading)}</div>`
              : `<div class="skill-item"><span class="skill-category">${escapeHtml(entry.heading)}</span></div>`,
          )
          .join('')}</div>`,
      );
    }
    out.push('</div>');
  }
  out.push('</div>');
  return out.join('\n');
}

/**
 * Selectable-text HTML (printed to PDF, or downloaded as is). No script, no external resources. Every dynamic
 * value goes through `escapeHtml`; links are only emitted for the safe `href` values prepared by the model.
 */
export function renderHtml(model: RenderModel, template: ResumeExportTemplate = 'modern'): string {
  const modern = template === 'modern';
  const paper = model.paper === 'Letter' ? 'Letter' : 'A4';
  const lang = /^[a-zA-Z-]{2,12}$/.test(model.language) ? model.language : 'pt-BR';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.name)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<style>:root { --paper: ${paper}; }${modern ? MODERN_CSS : CLASSIC_CSS}</style>
</head>
<body>
${modern ? modernBody(model) : classicBody(model)}
</body>
</html>`;
}
