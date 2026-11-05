import type { JobStatus, JobWorkMode } from '@chameleon/contracts';

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  saved: 'Salva',
  analyzed: 'Analisada',
  application_prepared: 'Candidatura preparada',
  application_sent: 'Candidatura enviada',
  interview: 'Entrevista',
  closed: 'Encerrada',
  archived: 'Arquivada',
};

export const JOB_WORK_MODE_LABELS: Record<JobWorkMode, string> = {
  remote: 'Remoto',
  hybrid: 'Híbrido',
  onsite: 'Presencial',
};

export const STATUS_OPTIONS = (Object.keys(JOB_STATUS_LABELS) as JobStatus[]).map((value) => ({
  value,
  label: JOB_STATUS_LABELS[value],
}));

export const WORK_MODE_OPTIONS = (Object.keys(JOB_WORK_MODE_LABELS) as JobWorkMode[]).map(
  (value) => ({ value, label: JOB_WORK_MODE_LABELS[value] }),
);

/** Titulo mostrado quando a vaga foi salva so com o texto. */
export const UNTITLED_JOB = 'Vaga sem título';
