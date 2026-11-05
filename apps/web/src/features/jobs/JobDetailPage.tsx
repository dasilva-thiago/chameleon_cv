import type { JobDetail, JobStatus } from '@chameleon/contracts';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { SelectField } from '../../components/ui/SelectField';
import { isApiError, messageForError } from '../../lib/api';
import { ResumesSection } from '../resumes/ResumesSection';
import { AnalysisSection } from './AnalysisSection';
import { primaryLinkClass } from './JobsPage';
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

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        {job.company !== null ? <p className="text-lg text-slate-800">{job.company}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Badge tone="info" prefix="Situação">
            {JOB_STATUS_LABELS[job.status]}
          </Badge>
          {job.workMode !== null ? <Badge>{JOB_WORK_MODE_LABELS[job.workMode]}</Badge> : null}
          {job.location !== null ? <Badge>{job.location}</Badge> : null}
          {job.postedOn !== null ? (
            <Badge prefix="Publicada em">{formatDate(job.postedOn)}</Badge>
          ) : null}
        </div>
        {job.url !== null ? (
          <p className="break-all text-sm">
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Abrir a vaga original (nova aba)
            </a>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
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
        <Link to={`/vagas/${job.id}/editar`} className={primaryLinkClass}>
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
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Excluir…
          </Button>
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

      {job.notes !== null ? (
        <section aria-labelledby="job-notes" className="flex flex-col gap-2">
          <h2 id="job-notes" className="text-lg font-semibold">
            Anotações
          </h2>
          <p className="whitespace-pre-wrap break-words text-base text-slate-900">{job.notes}</p>
        </section>
      ) : null}

      <section aria-labelledby="job-text" className="flex flex-col gap-2">
        <h2 id="job-text" className="text-lg font-semibold">
          Texto original da vaga
        </h2>
        <pre className="whitespace-pre-wrap break-words rounded-md border border-slate-400 bg-white p-4 font-sans text-base text-slate-900">
          {job.description}
        </pre>
      </section>

      <AnalysisSection jobId={job.id} />

      <ResumesSection jobId={job.id} />

      <div>
        <Link to="/vagas" className={secondaryLinkClass}>
          Voltar às vagas
        </Link>
      </div>
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
