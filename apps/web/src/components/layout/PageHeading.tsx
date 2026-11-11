import { useEffect, type ReactNode } from 'react';
import { APP_NAME } from '../../lib/config';

/** Define o titulo do documento (`Pagina · ChameleonCV`). */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · ${APP_NAME}`;
  }, [title]);
}

/** Titulo principal da pagina. Recebe foco programatico a cada navegacao (tabIndex -1). */
export function PageHeading({ children }: { children: ReactNode }) {
  return (
    <h1
      tabIndex={-1}
      className="text-title font-semibold tracking-tight text-ink-1 focus:outline-none"
    >
      {children}
    </h1>
  );
}
