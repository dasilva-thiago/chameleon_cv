import type { JobDetail, JobStatus } from '@chameleon/contracts';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ExpandableText } from '../../components/ui/ExpandableText';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { SelectField } from '../../components/ui/SelectField';
import { isApiError, messageForError } from '../../lib/api';
import { ResumesSection } from '../resumes/ResumesSection';
import { AnalysisSection } from './AnalysisSection';
import { JOB_STATUS_LABELS, JOB_WORK_MODE_LABELS, STATUS_OPTIONS, UNTITLED_JOB } from './labels';
import { useDeleteJob, useJob, usePatchJob } from './queries';

const secondaryLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

function JobView({ job }: { job: JobDetail }) {
  const navigate = useNavigate();
  const patch = usePatchJob();
  const remove = useDeleteJob();
  const [confirming, setConfirming] = useState(false);
  const title = job.title ?? UNTITLED_JOB;
  const archived = job.status === 'archived';

  const changeStatus = (status: JobStatus): void => {
    patch.mutate({ id: job.id, input: { status } });
  };

  const context = [
    job.company,
    job.location,
    job.workMode !== null ? JOB_WORK_MODE_LABELS[job.workMode] : null,
    job.postedOn !== null ? `Publicada em ${formatDate(job.postedOn)}` : null,
  ].filter((part): part is string => part !== null && part !== '');

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <PageHeader
          back={{ to: '/vagas', label: 'Vagas' }}
          title={title}
          meta={
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge tone={archived ? 'neutral' : 'info'}>{JOB_STATUS_LABELS[job.status]}</Badge>
              {context.length > 0 ? (
                <p className="text-base text-slate-800">{context.join(' · ')}</p>
              ) : null}
              {job.url !== null ? (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  Abrir a vaga original (nova aba)
                </a>
              ) : null}
            </div>
          }
        />

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-52">
            <SelectField
              label="Situação"
              placeholder={null}
              options={STATUS_OPTIONS}
              value={job.status}
              disabled={patch.isPending}
              onChange={(event) => {
                changeStatus(event.target.value as JobStatus);
              }}
            />
          </div>
          <Link to={`/vagas/${job.id}/editar`} className={secondaryLinkClass}>
            Editar
          </Link>
          <Button
            variant="secondary"
            disabled={patch.isPending}
            onClick={() => {
              changeStatus(archived ? 'saved' : 'archived');
            }}
          >
            {archived ? 'Desarquivar' : 'Arquivar'}
          </Button>
          {confirming ? null : (
            <button
              type="button"
              onClick={() => {
                setConfirming(true);
              }}
              className="ml-auto min-h-11 rounded-md px-2 text-sm font-medium text-red-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Excluir…
            </button>
          )}
        </div>

        <div role="status" aria-live="polite">
          {patch.isSuccess ? <Alert tone="success">Vaga atualizada.</Alert> : null}
        </div>
        {patch.isError ? (
          <Alert tone="error" title="Não foi possível atualizar">
            {messageForError(patch.error)}
          </Alert>
        ) : null}

        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="confirm-delete-title"
            className="flex flex-col gap-3 rounded-md border border-red-700 bg-red-50 p-4"
          >
            <p id="confirm-delete-title" className="font-semibold text-red-900">
              Excluir esta vaga definitivamente?
            </p>
            <p className="text-sm text-red-900">
              O texto e as anotações serão apagados e não poderão ser recuperados. Para só tirar da
              lista, use &quot;Arquivar&quot;.
            </p>
            {remove.isError ? (
              <Alert tone="error" title="Não foi possível excluir">
                {messageForError(remove.error)}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="danger"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(job.id, {
                    onSuccess: () => {
                      void navigate('/vagas');
                    },
                  });
                }}
              >
                {remove.isPending ? 'Excluindo…' : 'Excluir definitivamente'}
              </Button>
              <Button
                variant="secondary"
                disabled={remove.isPending}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <Section id="job-text" title="Texto original da vaga">
        <ExpandableText text={job.description} />
        {job.notes !== null ? (
          <div className="flex flex-col gap-1 rounded-md border border-slate-300 bg-slate-100 p-3">
            <h3 className="text-sm font-semibold text-slate-900">Suas anotações</h3>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{job.notes}</p>
          </div>
        ) : null}
      </Section>

      <AnalysisSection jobId={job.id} />

      <ResumesSection jobId={job.id} />
    </div>
  );
}

export function JobDetailPage() {
  const { jobId } = useParams();
  const query = useJob(jobId);
  usePageTitle(query.data?.job.title ?? 'Vaga');

  if (query.isPending) return <LoadingStatus label="Carregando a vaga…" />;
  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <PageHeading>Vaga</PageHeading>
        <Alert tone="error" title="Não foi possível abrir a vaga">
          {isApiError(query.error, 'NOT_FOUND')
            ? 'Esta vaga não foi encontrada. Ela pode ter sido excluída.'
            : messageForError(query.error)}
        </Alert>
        <Link to="/vagas" className={secondaryLinkClass}>
          Voltar às vagas
        </Link>
      </div>
    );
  }
  return <JobView job={query.data.job} />;
}
