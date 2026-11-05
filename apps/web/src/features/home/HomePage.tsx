import { Link } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { useSession } from '../auth/session';

const linkClass =
  'inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

export function HomePage() {
  usePageTitle('Início');
  const { data } = useSession();
  const user = data?.user;
  const name = user?.displayName ?? user?.email ?? '';

  return (
    <div className="flex flex-col gap-4">
      <PageHeading>Início</PageHeading>
      <p className="text-lg text-slate-900">Olá, {name}.</p>
      <section aria-labelledby="home-profile" className="flex flex-col gap-3">
        <h2 id="home-profile" className="text-lg font-semibold">
          Perfil profissional
        </h2>
        <p className="text-base text-slate-700">
          Mantenha sua base de experiências, projetos, formação e habilidades. A análise de vagas e
          os currículos chegam nas próximas etapas.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/perfil" className={linkClass}>
            Abrir meu perfil
          </Link>
          <Link to="/perfil/importar" className={linkClass}>
            Importar arquivo
          </Link>
          <Link to="/perfil/pendencias" className={linkClass}>
            Ver pendências
          </Link>
        </div>
      </section>
      <section aria-labelledby="home-jobs" className="flex flex-col gap-3">
        <h2 id="home-jobs" className="text-lg font-semibold">
          Vagas
        </h2>
        <p className="text-base text-slate-700">
          Guarde as vagas de interesse com o texto original e acompanhe a situação de cada uma.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/vagas/nova" className={linkClass}>
            Adicionar vaga
          </Link>
          <Link to="/vagas" className={linkClass}>
            Ver minhas vagas
          </Link>
        </div>
      </section>
    </div>
  );
}
