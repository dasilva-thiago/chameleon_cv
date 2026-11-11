import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { AuthenticatedLayout } from '../../components/layout/AuthenticatedLayout';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { PublicHeader } from '../../components/layout/PublicLayout';
import { ShellFrame } from '../../components/layout/ShellFrame';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { messageForError } from '../../lib/api';
import { useAuthNotice, useSession } from './session';

export interface LoginLocationState {
  /** Rota interna a abrir depois do login (caminho + query + hash). */
  from?: string | undefined;
}

/** Aceita apenas caminhos internos; evita redirecionamento aberto via estado de navegacao. */
export function safeInternalPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return undefined;
  if (/^\/(login|accept-invite)(?:[/?#]|$)/.test(value)) return undefined;
  return value;
}

function SessionScreen({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title);
  return (
    <ShellFrame header={<PublicHeader />} width="read">
      <PageHeading>{title}</PageHeading>
      {children}
    </ShellFrame>
  );
}

/** Rotas protegidas: carrega a sessao (`me`), redireciona ao login sem sessao e monta o shell. */
export function RequireAuth() {
  const session = useSession();
  const notice = useAuthNotice();
  const location = useLocation();

  if (session.isPending) {
    return (
      <SessionScreen title="Carregando">
        <LoadingStatus label="Verificando sua sessão…" />
      </SessionScreen>
    );
  }
  if (session.isError) {
    return (
      <SessionScreen title="Não foi possível carregar">
        <div className="mt-4 flex flex-col items-start gap-4">
          <Alert tone="error">{messageForError(session.error)}</Alert>
          <Button
            onClick={() => {
              void session.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      </SessionScreen>
    );
  }
  if (session.data === null) {
    const explicitSignOut = notice?.kind === 'signed-out' || notice?.kind === 'signed-out-all';
    const from = explicitSignOut
      ? undefined
      : `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from } satisfies LoginLocationState} />;
  }
  return <AuthenticatedLayout user={session.data.user} />;
}
