import { JOB_STATUS_FILTERS, type JobSummary } from '@chameleon/contracts';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePageTitle } from '../../components/layout/PageHeading';
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
  const context = [
    job.company,
    job.location,
    job.workMode !== null ? JOB_WORK_MODE_LABELS[job.workMode] : null,
  ].filter((part): part is string => part !== null && part !== '');
  return (
    <article className="relative flex flex-col gap-1.5 rounded-md border border-slate-400 bg-white p-4 hover:border-slate-600 hover:bg-slate-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-700">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">
          <Link
            to={`/vagas/${job.id}`}
            className="after:absolute after:inset-0 hover:underline focus-visible:outline-none"
          >
            {title}
          </Link>
        </h2>
        <Badge tone={job.status === 'saved' ? 'neutral' : 'info'}>
          {JOB_STATUS_LABELS[job.status]}
        </Badge>
      </div>
      {context.length > 0 ? (
        <p className="text-sm font-medium text-slate-800">{context.join(' · ')}</p>
      ) : null}
      <p className="line-clamp-2 text-sm text-slate-700">{job.excerpt}</p>
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Vagas"
        actions={
          <Link to="/vagas/nova" className={primaryLinkClass}>
            Adicionar vaga
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
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
        <div className="flex flex-col gap-3">
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
        </div>
      ) : null}
    </div>
  );
}
