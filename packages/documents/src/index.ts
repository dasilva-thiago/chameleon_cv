import type { ResumeContent, ResumeExportFormat, ResumeExportTemplate } from '@chameleon/contracts';
import { renderDocx } from './docx';
import { renderHtml } from './html';
import { renderPdf, type PdfOptions } from './pdf';
import { toRenderModel } from './render-model';

export const PACKAGE_NAME = '@chameleon/documents' as const;

export { renderHtml, escapeHtml } from './html';
export { renderDocx } from './docx';
export { ExportUnavailableError, renderPdf, type PdfOptions } from './pdf';
export {
  displayPhone,
  textLinesOf,
  toRenderModel,
  type RenderContact,
  type RenderEntry,
  type RenderModel,
  type RenderSection,
  type RenderSkillGroup,
} from './render-model';

export interface RenderedDocument {
  bytes: Uint8Array;
  contentType: string;
}

/** Renders an approved resume to the requested file format and template (`modern` by default). */
export async function renderResume(
  content: ResumeContent,
  format: ResumeExportFormat,
  options: PdfOptions & { template?: ResumeExportTemplate } = {},
): Promise<Uint8Array> {
  const model = toRenderModel(content);
  const template = options.template ?? 'modern';
  if (format === 'docx') return renderDocx(model, template);
  if (format === 'html') return new TextEncoder().encode(renderHtml(model, template));
  return renderPdf(model, { ...options, template });
}

/**
 * ASCII, filesystem-safe file name: `<Name>_<Title>_<Company>_<YYYYMMDD>.<ext>`. The name comes from the resume
 * header (the owner's profile); absent parts are skipped, never replaced by invented ones.
 */
export function exportFileName(
  parts: { name: string; title?: string | null; company?: string | null; date: Date },
  format: ResumeExportFormat,
): string {
  const clean = (value: string | null | undefined): string =>
    (value ?? '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  const day = parts.date.toISOString().slice(0, 10).replaceAll('-', '');
  const stem = [clean(parts.name), clean(parts.title), clean(parts.company)]
    .filter((part) => part !== '')
    .concat(day)
    .join('_');
  return `${stem === day ? 'curriculo_' : ''}${stem}.${format}`;
}
