import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronLeftIcon } from '../ui/icons';
import { cx, focusRing, transition } from '../ui/styles';
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
    <div className="flex flex-col gap-2">
      {back !== undefined ? (
        <Link
          to={back.to}
          className={cx(
            'inline-flex w-fit items-center gap-1 rounded-sm text-meta font-medium text-ink-3 hover:text-brand',
            transition,
            focusRing,
          )}
        >
          <ChevronLeftIcon />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <PageHeading>{title}</PageHeading>
          {meta !== undefined ? <div className="text-body text-ink-2">{meta}</div> : null}
        </div>
        {actions !== undefined ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
