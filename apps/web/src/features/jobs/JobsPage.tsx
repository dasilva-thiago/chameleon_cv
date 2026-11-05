import { JOB_STATUS_FILTERS, type JobSummary } from '@chameleon/contracts';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { SelectField } from '../../components/ui/SelectField';
import { TextField } from '../../components/ui/TextField';
import { messageForError } from '../../lib/api';
import { JOB_STATUS_LABELS, JOB_WORK_MODE_LABELS, UNTITLED_JOB } from './labels';
import { useJobs } from './queries';

type StatusFilter = (typeof JOB_STATUS_FILTERS)[number];

const FILTER_LABELS: Record<StatusFilter, string> = {
  active: 'Em andamento',
  all: 'Todas',
  ...JOB_STATUS_LABELS,
};

const FILTER_OPTIONS = JOB_STATUS_FILTERS.map((value) => ({
  value,
  label: FILTER_LABELS[value],
}));

export const primaryLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-transparent bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

function JobCard({ job }: { job: JobSummary }) {
  const title = job.title ?? UNTITLED_JOB;
  return (
    <article className="flex flex-col gap-2 rounded-md border border-slate-400 bg-white p-4">
      <h2 className="text-lg font-semibold text-slate-900">
        <Link
          to={`/vagas/${job.id}`}
          className="text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          {title}
        </Link>
      </h2>
      {job.company !== null ? <p className="text-base text-slate-800">{job.company}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Badge tone={job.status === 'saved' ? 'neutral' : 'info'} prefix="Situação">
          {JOB_STATUS_LABELS[job.status]}
        </Badge>
        {job.workMode !== null ? <Badge>{JOB_WORK_MODE_LABELS[job.workMode]}</Badge> : null}
        {job.location !== null ? <Badge>{job.location}</Badge> : null}
      </div>
      <p className="text-sm text-slate-700">{job.excerpt}</p>
    </article>
  );
}

/** Painel de vagas salvas: lista, busca e filtro por situação. O texto integral fica no detalhe. */
export function JobsPage() {
  usePageTitle('Vagas');
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const list = useJobs({
    status,
    ...(deferredSearch !== '' ? { q: deferredSearch } : {}),
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <PageHeading>Vagas</PageHeading>
          <p className="text-base text-slate-800">
            Cole a descrição de uma vaga para guardá-la, acompanhar a situação e consultar o texto
            original depois.
          </p>
        </div>
        <Link to="/vagas/nova" className={primaryLinkClass}>
          Adicionar vaga
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <TextField
          label="Buscar"
          type="search"
          placeholder="Empresa, cargo, local ou trecho do texto"
          autoComplete="off"
          value={search}
          maxLength={100}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
        <SelectField
          label="Mostrar"
          placeholder={null}
          options={FILTER_OPTIONS}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as StatusFilter);
          }}
        />
      </div>

      {list.isPending ? <LoadingStatus label="Carregando vagas…" /> : null}
      {list.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error" title="Não foi possível carregar as vagas">
            {messageForError(list.error)}
          </Alert>
          <Button
            onClick={() => {
              void list.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : null}
      {list.isSuccess ? (
        <>
          <p role="status" className="text-sm text-slate-700">
            {list.data.counts.active} em andamento · {list.data.counts.total} no total
          </p>
          {list.data.jobs.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-400 bg-white p-4 text-base text-slate-800">
              {list.data.counts.total === 0
                ? 'Nenhuma vaga salva ainda. Use "Adicionar vaga" para colar a primeira.'
                : 'Nenhuma vaga encontrada com este filtro ou busca.'}
            </p>
          ) : (
            <ul aria-label="Vagas salvas" className="flex flex-col gap-3">
              {list.data.jobs.map((job) => (
                <li key={job.id}>
                  <JobCard job={job} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
