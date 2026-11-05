import type { ResumeExportFormat, ResumeVersionStatus } from '@chameleon/contracts';

export const VERSION_STATUS_LABELS: Record<ResumeVersionStatus, string> = {
  draft: 'Rascunho',
  approved: 'Aprovada',
};

export const EXPORT_FORMAT_LABELS: Record<ResumeExportFormat, string> = {
  docx: 'DOCX',
  pdf: 'PDF',
};

export const CONTACT_KIND_LABELS = {
  email: 'E-mail',
  phone: 'Telefone',
  link: 'Link',
} as const;

export const ORIGIN_LABELS = {
  generated: 'Gerado',
  edited: 'Editado',
  added: 'Adicionado',
} as const;

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export function countsText(counts: { errors: number; warnings: number }): string {
  const errors = `${String(counts.errors)} ${counts.errors === 1 ? 'erro' : 'erros'}`;
  const warnings = `${String(counts.warnings)} ${counts.warnings === 1 ? 'aviso' : 'avisos'}`;
  return `${errors} e ${warnings}`;
}

export const editorPath = (resumeId: string, versionId: string): string =>
  `/curriculos/${resumeId}/versoes/${versionId}`;
