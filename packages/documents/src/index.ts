import type { ResumeContent, ResumeExportFormat } from '@chameleon/contracts';
import { renderDocx } from './docx';
import { renderPdf, type PdfOptions } from './pdf';
import { toRenderModel } from './render-model';

export const PACKAGE_NAME = '@chameleon/documents' as const;

export { renderHtml, escapeHtml } from './html';
export { renderDocx } from './docx';
export { ExportUnavailableError, renderPdf, type PdfOptions } from './pdf';
export {
  textLinesOf,
  toRenderModel,
  type RenderContact,
  type RenderEntry,
  type RenderModel,
  type RenderSection,
} from './render-model';

export interface RenderedDocument {
  bytes: Uint8Array;
  contentType: string;
}

/** Renders an approved resume to the requested file format. */
export async function renderResume(
  content: ResumeContent,
  format: ResumeExportFormat,
  options: PdfOptions = {},
): Promise<Uint8Array> {
  const model = toRenderModel(content);
  return format === 'docx' ? renderDocx(model) : renderPdf(model, options);
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
