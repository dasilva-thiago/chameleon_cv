import type { ReactNode } from 'react';

/**
 * Seção de página: título (h2) com uma linha de apoio opcional, ações à direita e uma linha divisória.
 * Mesma escala em todas as telas, para o olho separar "o que é esta área" de "o que fazer nela".
 */
export function Section({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  /** Uma linha, no máximo. Explicações longas ficam em um bloco recolhível dentro da seção. */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-slate-300 pb-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-xl font-semibold text-slate-900">
            {title}
          </h2>
          {description !== undefined ? (
            <p className="text-sm text-slate-700">{description}</p>
          ) : null}
        </div>
        {actions !== undefined ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
