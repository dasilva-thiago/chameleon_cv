import { Link } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';

export function NotFoundPage() {
  usePageTitle('Página não encontrada');
  return (
    <div className="flex flex-col items-start gap-4">
      <PageHeading>Página não encontrada</PageHeading>
      <p className="text-base text-slate-700">O endereço acessado não existe ou foi movido.</p>
      <Link to="/" className="font-medium text-blue-800 underline">
        Ir para o início
      </Link>
    </div>
  );
}
