import { JOB_STATUS_FILTERS, type JobSummary } from '@chameleon/contracts';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, LinkButton } from '../../components/ui/Button';
import { EvidenceRail, RecommendationBadge, Score } from '../../components/ui/Evaluation';
import { BriefcaseIcon, ChevronRightIcon, PlusIcon } from '../../components/ui/icons';
import { SelectField } from '../../components/ui/SelectField';
import { Skeleton } from '../../components/ui/Skeleton';
import { cx, transition } from '../../components/ui/styles';
import { TextField } from '../../components/ui/TextField';
import { messageForError } from '../../lib/api';
import { JOB_STATUS_LABELS, JOB_WORK_MODE_LABELS, UNTITLED_JOB } from './labels';
import { useJobs, usePrefetchJob } from './queries';

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

export function jobContext(job: Pick<JobSummary, 'company' | 'location' | 'workMode'>): string {
  return [
    job.company,
    job.location,
    job.workMode !== null ? JOB_WORK_MODE_LABELS[job.workMode] : null,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

/** One dense row: title and context, score and rail, situation. The whole row is the link's hit area. */
export function JobRow({
  job,
  compact = false,
  withCompany = false,
  headingLevel = 2,
}: {
  job: JobSummary;
  compact?: boolean;
  /** The company goes in the link text ("Cargo — Empresa") instead of the context line. */
  withCompany?: boolean;
  /** Heading level of the row title under the page outline. */
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';
  const prefetch = usePrefetchJob();
  const title = job.title ?? UNTITLED_JOB;
  const context = jobContext(withCompany ? { ...job, company: null } : job);
  const evaluation = job.evaluation ?? null;
  return (
    <article
      className={cx(
        'group relative grid items-center gap-x-4 gap-y-2 px-4 py-3 hover:bg-sunken active:bg-line',
        'grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_9rem_auto]',
        compact ? '' : 'md:grid-cols-[minmax(0,1fr)_14rem_10rem_auto]',
        transition,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading className="truncate text-item font-semibold text-ink-1">
          <Link
            to={`/vagas/${job.id}`}
            onMouseEnter={() => {
              prefetch(job.id);
            }}
            onFocus={() => {
              prefetch(job.id);
            }}
            className="rounded-sm outline-none after:absolute after:inset-0 group-hover:text-brand-text focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand"
          >
            {title}
            {withCompany && job.company !== null ? ` — ${job.company}` : ''}
          </Link>
        </Heading>
        {context !== '' ? <p className="truncate text-meta text-ink-3">{context}</p> : null}
      </div>
      {compact ? null : (
        <div className="hidden items-center gap-3 md:flex">
          {evaluation !== null ? (
            <RecommendationBadge recommendation={evaluation.recommendation} />
          ) : (
            <span className="text-meta text-ink-3">Não avaliada</span>
          )}
        </div>
      )}
      <div className="hidden items-center gap-3 sm:flex">
        {evaluation !== null ? (
          <>
            <Score score={evaluation.score} />
            <EvidenceRail rail={evaluation.rail} />
          </>
        ) : compact ? (
          <span className="text-meta text-ink-3">Não avaliada</span>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        {evaluation?.stale === true ? <Badge tone="warn">Desatualizada</Badge> : null}
        <Badge>{JOB_STATUS_LABELS[job.status]}</Badge>
        <span
          aria-hidden="true"
          className="text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5"
        >
          <ChevronRightIcon />
        </span>
      </div>
    </article>
  );
}

function ListSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando vagas"
      className="divide-y divide-line rounded-panel border border-line bg-surface"
    >
      {[0, 1, 2, 3].map((n) => (
        <div key={n} className="flex items-center gap-4 px-4 py-4">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-3 w-28 sm:block" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
      <span className="sr-only">Carregando vagas…</span>
    </div>
  );
}

/** Painel de vagas salvas: lista densa, busca e filtro por situação. O texto integral fica no detalhe. */
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
        meta={
          list.isSuccess ? (
            <p role="status" className="tabular-nums">
              {list.data.counts.active} em andamento · {list.data.counts.total} no total
            </p>
          ) : undefined
        }
        actions={
          <LinkButton to="/vagas/nova" variant="primary" icon={<PlusIcon />}>
            Adicionar vaga
          </LinkButton>
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

      {list.isPending ? <ListSkeleton /> : null}
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
        list.data.jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-panel border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
              <BriefcaseIcon />
            </span>
            <p className="max-w-md text-body text-ink-2">
              {list.data.counts.total === 0
                ? 'Nenhuma vaga salva ainda. Use "Adicionar vaga" para colar a primeira.'
                : 'Nenhuma vaga encontrada com este filtro ou busca.'}
            </p>
          </div>
        ) : (
          <div
            className={cx(
              'overflow-clip rounded-panel border border-line bg-surface shadow-xs',
              list.isPlaceholderData ? 'opacity-60' : '',
              transition,
            )}
            aria-busy={list.isPlaceholderData ? true : undefined}
          >
            <div
              aria-hidden="true"
              className="sticky top-14 z-10 hidden grid-cols-[minmax(0,1fr)_14rem_10rem_auto] gap-x-4 border-b border-line bg-sunken px-4 py-2 text-overline font-semibold uppercase tracking-wider text-ink-3 md:grid"
            >
              <span>Vaga</span>
              <span>Recomendação</span>
              <span>Nota e requisitos</span>
              <span className="text-right">Situação</span>
            </div>
            <ul aria-label="Vagas salvas" className="divide-y divide-line">
              {list.data.jobs.map((job) => (
                <li key={job.id}>
                  <JobRow job={job} />
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}
    </div>
  );
}
