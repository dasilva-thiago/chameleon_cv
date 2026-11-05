import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { NavigationType, useLocation, useNavigationType } from 'react-router';

export const MAIN_ID = 'conteudo';

/**
 * Estrutura comum: link para pular ao conteudo, landmarks (banner e main) e foco no titulo
 * da pagina a cada navegacao interna (leitores de tela anunciam a nova pagina).
 */
export function ShellFrame({
  header,
  children,
  wide = false,
}: {
  header: ReactNode;
  children: ReactNode;
  /** Area de conteudo larga (editor do perfil, com navegacao lateral). */
  wide?: boolean;
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
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <a
        href={`#${MAIN_ID}`}
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-blue-800 focus:outline-2 focus:outline-blue-700"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-slate-300 bg-white">{header}</header>
      <main
        id={MAIN_ID}
        ref={mainRef}
        tabIndex={-1}
        className={`mx-auto w-full ${wide ? 'max-w-6xl' : 'max-w-3xl'} flex-1 px-4 py-8 focus:outline-none sm:px-6`}
      >
        {children}
      </main>
    </div>
  );
}
