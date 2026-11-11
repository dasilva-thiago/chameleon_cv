import { JOB_STATUSES } from '@chameleon/contracts';
import { Link } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Badge } from '../../components/ui/Badge';
import { useSession } from '../auth/session';
import { JOB_STATUS_LABELS, UNTITLED_JOB } from '../jobs/labels';
import { useJobs } from '../jobs/queries';
import { useProfileBase } from '../profile/queries';

const RECENT_JOBS = 5;

const primaryLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-transparent bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const secondaryLinkClass =
  'inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const textLinkClass =
  'text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

/** Vagas em andamento: contagem por situação e as mais recentes. Se não carregar, o bloco some (não é crítico). */
function JobsOverview() {
  const jobs = useJobs({ status: 'active' });
  if (!jobs.isSuccess) return null;

  const { counts } = jobs.data;
  const recent = jobs.data.jobs.slice(0, RECENT_JOBS);
  const statuses = JOB_STATUSES.filter(
    (status) => status !== 'archived' && (counts.byStatus[status] ?? 0) > 0,
  );

  return (
    <section aria-labelledby="home-jobs" className="flex flex-col gap-3">
      <h2 id="home-jobs" className="text-lg font-semibold">
        Vagas em andamento
      </h2>
      {recent.length === 0 ? (
        <p className="text-base text-slate-700">Nenhuma vaga em andamento.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {statuses.map((status) => (
              <Badge key={status} tone="info">
                {JOB_STATUS_LABELS[status]}: {String(counts.byStatus[status] ?? 0)}
              </Badge>
            ))}
          </div>
          <ul className="flex flex-col divide-y divide-slate-300 rounded-md border border-slate-400 bg-white">
            {recent.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <Link to={`/vagas/${job.id}`} className={textLinkClass}>
                  {job.title ?? UNTITLED_JOB}
                  {job.company !== null ? ` — ${job.company}` : ''}
                </Link>
                <Badge>{JOB_STATUS_LABELS[job.status]}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-sm">
            <Link to="/vagas" className={textLinkClass}>
              Ver todas as vagas ({String(counts.active)})
            </Link>
          </p>
        </>
      )}
    </section>
  );
}

/** Só aparece enquanto a base profissional não foi preenchida. */
function ProfileAttention() {
  const state = useProfileBase();
  if (!state.isSuccess || state.data.base !== null) return null;
  return (
    <section aria-labelledby="home-profile" className="flex flex-col gap-2">
      <h2 id="home-profile" className="text-lg font-semibold">
        Base profissional
      </h2>
      <p className="text-base">
        <Link to="/perfil" className={textLinkClass}>
          Preencha o seu CV e o seu perfil
        </Link>{' '}
        para avaliar vagas e gerar currículos.
      </p>
    </section>
  );
}

/** Painel de trabalho: o que está em andamento e os atalhos do dia a dia. */
export function HomePage() {
  usePageTitle('Início');
  const { data } = useSession();
  const user = data?.user;
  const name = user?.displayName ?? user?.email ?? '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeading>Início</PageHeading>
        <p className="text-lg text-slate-900">Olá, {name}.</p>
        <div className="flex flex-wrap gap-3">
          <Link to="/vagas/nova" className={primaryLinkClass}>
            Adicionar vaga
          </Link>
          <Link to="/perfil" className={secondaryLinkClass}>
            Editar base
          </Link>
        </div>
      </div>
      <JobsOverview />
      <ProfileAttention />
    </div>
  );
}
