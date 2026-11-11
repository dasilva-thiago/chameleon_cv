import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeading } from './PageHeading';

/**
 * Cabeçalho de página: (voltar) → título → linha de apoio → ações. Uma ação principal por página, à direita do
 * título; em telas estreitas as ações descem para baixo do título.
 */
export function PageHeader({
  title,
  back,
  meta,
  actions,
}: {
  title: ReactNode;
  back?: { to: string; label: string };
  /** Linha(s) curta(s) de contexto sob o título (empresa, local, situação…). */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {back !== undefined ? (
        <Link
          to={back.to}
          className="w-fit text-sm text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <span aria-hidden="true">← </span>
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <PageHeading>{title}</PageHeading>
          {meta}
        </div>
        {actions !== undefined ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}
