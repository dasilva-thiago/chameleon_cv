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
          Mantenha sua base de experiências, projetos, formação e habilidades. As áreas de vagas e
          currículos chegam nas próximas etapas.
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
    </div>
  );
}
