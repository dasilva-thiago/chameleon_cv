import { Link } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { buttonClasses } from '../../components/ui/styles';

export function NotFoundPage() {
  usePageTitle('Página não encontrada');
  return (
    <div className="mt-[6vh] flex flex-col items-start gap-4">
      <p className="font-mono text-score font-semibold text-brand">404</p>
      <PageHeading>Página não encontrada</PageHeading>
      <p className="text-body text-ink-2">O endereço acessado não existe ou foi movido.</p>
      <Link to="/" className={buttonClasses('primary')}>
        Ir para o início
      </Link>
    </div>
  );
}
