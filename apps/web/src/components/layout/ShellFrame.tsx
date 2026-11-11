import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router';
import { cx } from '../ui/styles';

export const MAIN_ID = 'conteudo';

/** Content widths (plan §3.5): reading forms, working lists, full-width editors. */
export type ShellWidth = 'read' | 'work' | 'full';

const WIDTHS: Record<ShellWidth, string> = {
  read: 'max-w-[44rem]',
  work: 'max-w-[80rem]',
  full: 'max-w-[110rem]',
};

/**
 * Estrutura comum: link para pular ao conteudo, landmarks (banner, navegação lateral opcional e main) e foco no
 * titulo da pagina a cada navegacao interna (leitores de tela anunciam a nova pagina).
 */
export function ShellFrame({
  header,
  sidebar,
  children,
  width = 'work',
}: {
  header: ReactNode;
  /** Barra lateral (área autenticada). */
  sidebar?: ReactNode;
  children: ReactNode;
  width?: ShellWidth;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  // Na carga inicial (POP) o foco fica no inicio do documento, antes do link "Pular".
  // Se o layout for montado por uma navegacao (ex.: login -> inicio), o foco vai ao titulo.
  const previousPath = useRef<string | null>(
    navigationType === NavigationType.Pop ? pathname : null,
  );

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    const heading = mainRef.current?.querySelector<HTMLElement>('h1');
    (heading ?? mainRef.current)?.focus();
  }, [pathname]);

  const skipToContent = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className="flex min-h-screen bg-canvas text-ink-1">
      <a
        href={`#${MAIN_ID}`}
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:font-medium focus:text-brand focus:shadow-md focus:outline-2 focus:outline-brand"
      >
        Pular para o conteúdo
      </a>
      {sidebar}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
          {header}
        </header>
        <main
          id={MAIN_ID}
          ref={mainRef}
          tabIndex={-1}
          className={cx(
            'mx-auto w-full flex-1 px-4 pb-16 pt-6 focus:outline-none sm:px-6 lg:px-8 lg:pt-8',
            WIDTHS[width],
          )}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
