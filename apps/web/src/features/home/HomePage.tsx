import type { JobSummary } from '@chameleon/contracts';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePageTitle } from '../../components/layout/PageHeading';
import { LinkButton } from '../../components/ui/Button';
import { FlowSteps } from '../../components/ui/FlowSteps';
import {
  AlertIcon,
  CheckCircleIcon,
  DocumentIcon,
  PlusIcon,
  SparkIcon,
} from '../../components/ui/icons';
import { Skeleton } from '../../components/ui/Skeleton';
import { cx, focusRing, linkClass, transition } from '../../components/ui/styles';
import { useSession } from '../auth/session';
import { JobRow } from '../jobs/JobsPage';
import { useJobs } from '../jobs/queries';
import { useProfileBase } from '../profile/queries';

const RECENT_JOBS = 6;

function StatTile({
  to,
  label,
  value,
  icon,
  tone,
}: {
  to: string;
  label: string;
  value: number;
  icon: ReactNode;
  tone: 'brand' | 'evid' | 'attn';
}) {
  return (
    <Link
      to={to}
      className={cx(
        'group flex items-center gap-3 rounded-panel border border-line bg-surface p-4 hover:border-line-strong hover:shadow-xs active:shadow-none',
        transition,
        focusRing,
      )}
    >
      <span
        className={cx(
          'flex size-9 shrink-0 items-center justify-center rounded-control',
          tone === 'brand' ? 'bg-brand-soft text-brand' : '',
          tone === 'evid' ? 'bg-evid-soft text-evid' : '',
          tone === 'attn' ? 'bg-attn-soft text-attn-text' : '',
        )}
      >
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="font-mono text-section font-semibold tabular-nums text-ink-1">
          {value}
        </span>
        <span className="text-meta text-ink-3 group-hover:text-ink-2">{label}</span>
      </span>
    </Link>
  );
}

function JobGroup({ title, jobs }: { title: string; jobs: readonly JobSummary[] }) {
  if (jobs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-overline font-semibold uppercase tracking-wider text-ink-3">
        {title} <span className="font-mono">({jobs.length})</span>
      </h3>
      <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface shadow-xs">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobRow job={job} compact withCompany headingLevel={4} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vagas em andamento, agrupadas pelo que falta fazer. Se não carregar, o bloco some (não é crítico). */
function JobsOverview() {
  const jobs = useJobs({ status: 'active' });
  if (jobs.isPending) {
    return (
      <div className="grid gap-3 sm:grid-cols-3" role="status" aria-label="Carregando as vagas">
        {[0, 1, 2].map((n) => (
          <Skeleton key={n} className="h-[4.5rem] rounded-panel" />
        ))}
      </div>
    );
  }
  if (!jobs.isSuccess) return null;

  const { counts } = jobs.data;
  const list = jobs.data.jobs;
  const toEvaluate = list.filter(
    (job) => (job.evaluation ?? null) === null || job.evaluation?.stale === true,
  );
  const evaluated = list.filter((job) => job.evaluation != null && !job.evaluation.stale);
  const recommended = evaluated.filter((job) => job.evaluation?.recommendation === 'apply').length;
  const stale = list.filter((job) => job.evaluation?.stale === true).length;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          to="/vagas"
          label="Para avaliar"
          value={toEvaluate.length}
          icon={<SparkIcon />}
          tone="brand"
        />
        <StatTile
          to="/vagas"
          label="Recomendadas"
          value={recommended}
          icon={<CheckCircleIcon />}
          tone="evid"
        />
        <StatTile
          to="/vagas"
          label="Avaliações desatualizadas"
          value={stale}
          icon={<AlertIcon />}
          tone="attn"
        />
      </div>

      <section aria-labelledby="home-jobs" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="home-jobs" className="text-section font-semibold">
            Vagas em andamento
          </h2>
          {list.length > 0 ? (
            <Link to="/vagas" className={cx(linkClass, 'text-meta')}>
              Ver todas as vagas ({String(counts.active)})
            </Link>
          ) : null}
        </div>
        {list.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line-strong bg-surface p-6 text-center text-body text-ink-2">
            Nenhuma vaga em andamento.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <JobGroup title="Para avaliar" jobs={toEvaluate.slice(0, RECENT_JOBS)} />
            <JobGroup title="Avaliadas" jobs={evaluated.slice(0, RECENT_JOBS)} />
          </div>
        )}
      </section>
    </>
  );
}

/** Só aparece enquanto a base profissional não foi preenchida. */
function ProfileAttention() {
  const state = useProfileBase();
  if (!state.isSuccess || state.data.base !== null) return null;
  return (
    <section
      aria-labelledby="home-profile"
      className="flex flex-col gap-4 rounded-panel border border-brand/30 bg-brand-soft/60 p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="home-profile" className="text-section font-semibold">
          Comece pela sua base profissional
        </h2>
        <p className="text-body text-ink-2">
          O seu CV e o seu perfil em Markdown são a fonte de tudo: as avaliações e os currículos só
          afirmam o que está neles.
        </p>
      </div>
      <FlowSteps current={0} />
      <div>
        <LinkButton to="/perfil" variant="primary" icon={<DocumentIcon />}>
          Preencher a base
        </LinkButton>
      </div>
    </section>
  );
}

/** Fila de trabalho: o que falta fazer em cada vaga e os atalhos do dia a dia. */
export function HomePage() {
  usePageTitle('Início');
  const { data } = useSession();
  const user = data?.user;
  const name = user?.displayName ?? user?.email ?? '';

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Início"
        meta={<p>Olá, {name}.</p>}
        actions={
          <>
            <LinkButton to="/perfil" variant="secondary">
              Editar base
            </LinkButton>
            <LinkButton to="/vagas/nova" variant="primary" icon={<PlusIcon />}>
              Adicionar vaga
            </LinkButton>
          </>
        }
      />
      <ProfileAttention />
      <JobsOverview />
    </div>
  );
}
