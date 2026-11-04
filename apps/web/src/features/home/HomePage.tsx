import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { useSession } from '../auth/session';

export function HomePage() {
  usePageTitle('Início');
  const { data } = useSession();
  const user = data?.user;
  const name = user?.displayName ?? user?.email ?? '';

  return (
    <div className="flex flex-col gap-4">
      <PageHeading>Início</PageHeading>
      <p className="text-lg text-slate-900">Olá, {name}.</p>
      <p className="text-base text-slate-700">
        Sua conta está ativa. As áreas de perfil profissional e de currículos serão disponibilizadas
        nas próximas etapas do produto.
      </p>
    </div>
  );
}
