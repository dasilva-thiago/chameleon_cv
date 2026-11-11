import type { JobDetail, JobStatus, ResumeSummary } from '@chameleon/contracts';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button, LinkButton } from '../../components/ui/Button';
import { EvidenceRail, RecommendationBadge, Score } from '../../components/ui/Evaluation';
import { ExpandableText } from '../../components/ui/ExpandableText';
import { FlowSteps } from '../../components/ui/FlowSteps';
import { ExternalIcon, SparkIcon } from '../../components/ui/icons';
import { SelectField } from '../../components/ui/SelectField';
import { Skeleton } from '../../components/ui/Skeleton';
import { cx, linkClass, panelClass } from '../../components/ui/styles';
import { useToast } from '../../components/ui/Toast';
import { isApiError, messageForError } from '../../lib/api';
import { useJobResumes } from '../resumes/queries';
import { ResumesSection } from '../resumes/ResumesSection';
import { AnalysisSection, type AnalysisQuery, type RunAnalysis } from './AnalysisSection';
import { JOB_STATUS_LABELS, JOB_WORK_MODE_LABELS, STATUS_OPTIONS, UNTITLED_JOB } from './labels';
import { useAnalysis, useDeleteJob, useJob, usePatchJob, useRunAnalysis } from './queries';

function formatDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

/** Where the job is in the flow: 1 = saved, 2 = to evaluate, 3 = evaluated (resume next), 4 = resume, 5 = approved. */
function flowStep(evaluated: boolean, resumes: readonly ResumeSummary[] | undefined): number {
  if (!evaluated) return 2;
  const versions = (resumes ?? []).flatMap((resume) => resume.versions);
  if (versions.some((version) => version.status === 'approved')) return 5;
  return versions.length > 0 ? 4 : 3;
}

function scrollToSection(id: string): void {
  const target = document.getElementById(id);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Painel fixo da vaga: nota, recomendação, trilho, próxima ação, fluxo e situação. */
function JobPanel({ job, query, run }: { job: JobDetail; query: AnalysisQuery; run: RunAnalysis }) {
  const navigate = useNavigate();
  const patch = usePatchJob();
  const remove = useDeleteJob();
  const toast = useToast();
  const resumes = useJobResumes(job.id);
  const [confirming, setConfirming] = useState(false);
  const archived = job.status === 'archived';
  const analysis = query.isSuccess ? query.data.analysis : null;
  const stale = query.isSuccess && query.data.stale;
  const result = analysis?.result;

  const rail = { strong: 0, partial: 0, missing: 0, na: 0 };
  for (const match of result?.matches ?? []) rail[match.match] += 1;

  const changeStatus = (status: JobStatus): void => {
    patch.mutate(
      { id: job.id, input: { status } },
      {
        onSuccess: () => {
          toast.show({ tone: 'success', message: 'Vaga atualizada.' });
        },
      },
    );
  };

  const evaluateButton = (
    <Button
      variant={analysis === null || stale ? 'primary' : 'ghost'}
      size={analysis === null || stale ? 'md' : 'sm'}
      loading={run.isPending}
      icon={<SparkIcon />}
      className={analysis === null || stale ? 'w-full' : ''}
      onClick={() => {
        run.mutate({ id: job.id, force: analysis !== null && !stale });
      }}
    >
      {run.isPending ? 'Avaliando…' : analysis === null ? 'Avaliar vaga' : 'Avaliar de novo'}
    </Button>
  );

  return (
    <aside aria-label="Resumo da vaga" className="flex flex-col gap-4 lg:sticky lg:top-20">
      <div className={cx(panelClass, 'flex flex-col gap-4 p-5 shadow-xs')}>
        {query.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="h-2.5 w-full rounded-full" />
          </div>
        ) : result !== undefined ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Score score={result.score} size="hero" />
              <RecommendationBadge recommendation={result.verdict.recommendation} />
            </div>
            <EvidenceRail rail={rail} size="full" />
            {stale ? <Badge tone="warn">Desatualizada</Badge> : null}
          </>
        ) : (
          <p className="text-body text-ink-2">
            Ainda sem nota. A avaliação compara a vaga com a sua base.
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-overline font-semibold uppercase tracking-wider text-ink-3">
            Próxima ação
          </p>
          {analysis === null || stale ? (
            evaluateButton
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  scrollToSection('job-resumes-section');
                }}
              >
                {result?.verdict.recommendation === 'skip'
                  ? 'Ver currículos'
                  : 'Ir para os currículos'}
              </Button>
              {evaluateButton}
            </div>
          )}
        </div>

        <FlowSteps
          current={flowStep(analysis !== null, resumes.data?.resumes)}
          className="border-t border-line pt-4"
        />
      </div>

      <div className={cx(panelClass, 'flex flex-col gap-3 p-5')}>
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
        {patch.isError ? (
          <Alert tone="error" title="Não foi possível atualizar">
            {messageForError(patch.error)}
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <LinkButton to={`/vagas/${job.id}/editar`} size="sm">
            Editar
          </LinkButton>
          <Button
            variant="secondary"
            size="sm"
            disabled={patch.isPending}
            onClick={() => {
              changeStatus(archived ? 'saved' : 'archived');
            }}
          >
            {archived ? 'Desarquivar' : 'Arquivar'}
          </Button>
          {confirming ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-risk-text hover:bg-risk-soft hover:text-risk-text"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Excluir…
            </Button>
          )}
        </div>
        {confirming ? (
          <div
            role="alertdialog"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-text"
            className="flex animate-enter flex-col gap-3 rounded-control border border-risk/40 bg-risk-soft p-4"
          >
            <p id="confirm-delete-title" className="font-semibold text-risk-text">
              Excluir esta vaga definitivamente?
            </p>
            <p id="confirm-delete-text" className="text-meta text-ink-2">
              O texto e as anotações serão apagados e não poderão ser recuperados. Para só tirar da
              lista, use &quot;Arquivar&quot;.
            </p>
            {remove.isError ? (
              <Alert tone="error" title="Não foi possível excluir">
                {messageForError(remove.error)}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                size="sm"
                loading={remove.isPending}
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
                size="sm"
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
    </aside>
  );
}

function JobView({ job }: { job: JobDetail }) {
  const query = useAnalysis(job.id);
  const run = useRunAnalysis();
  const title = job.title ?? UNTITLED_JOB;

  const context = [
    job.company,
    job.location,
    job.workMode !== null ? JOB_WORK_MODE_LABELS[job.workMode] : null,
    job.postedOn !== null ? `Publicada em ${formatDate(job.postedOn)}` : null,
  ].filter((part): part is string => part !== null && part !== '');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: '/vagas', label: 'Vagas' }}
        title={title}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge>{JOB_STATUS_LABELS[job.status]}</Badge>
            {context.length > 0 ? <p>{context.join(' · ')}</p> : null}
            {job.url !== null ? (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cx(linkClass, 'inline-flex items-center gap-1 text-meta')}
              >
                Abrir a vaga original (nova aba)
                <ExternalIcon />
              </a>
            ) : null}
          </div>
        }
      />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 flex min-w-0 flex-col gap-10 lg:order-1">
          <AnalysisSection query={query} run={run} />
          <div id="job-resumes-section">
            <ResumesSection jobId={job.id} />
          </div>
          <Section id="job-text" title="Texto original da vaga">
            <ExpandableText text={job.description} />
            {job.notes !== null ? (
              <div className="flex flex-col gap-1 rounded-panel border border-line bg-sunken p-4">
                <h3 className="text-meta font-semibold text-ink-1">Suas anotações</h3>
                <p className="whitespace-pre-wrap break-words text-body text-ink-2">{job.notes}</p>
              </div>
            ) : null}
          </Section>
        </div>
        <div className="order-1 lg:order-2">
          <JobPanel job={job} query={query} run={run} />
        </div>
      </div>
    </div>
  );
}

function JobSkeleton() {
  return (
    <div role="status" aria-label="Carregando a vaga" className="flex flex-col gap-6">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-7 w-72" />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-32 rounded-panel" />
          <Skeleton className="h-64 rounded-panel" />
        </div>
        <Skeleton className="h-72 rounded-panel" />
      </div>
      <span className="sr-only">Carregando a vaga…</span>
    </div>
  );
}

export function JobDetailPage() {
  const { jobId } = useParams();
  const query = useJob(jobId);
  usePageTitle(query.data?.job.title ?? 'Vaga');

  if (query.isPending) return <JobSkeleton />;
  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <PageHeading>Vaga</PageHeading>
        <Alert tone="error" title="Não foi possível abrir a vaga">
          {isApiError(query.error, 'NOT_FOUND')
            ? 'Esta vaga não foi encontrada. Ela pode ter sido excluída.'
            : messageForError(query.error)}
        </Alert>
        <Link to="/vagas" className={linkClass}>
          Voltar às vagas
        </Link>
      </div>
    );
  }
  return <JobView job={query.data.job} />;
}
