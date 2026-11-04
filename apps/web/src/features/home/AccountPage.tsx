import { useState } from 'react';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { messageForError } from '../../lib/api';
import { useLogoutAll, useSession } from '../auth/session';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date);
}

export function AccountPage() {
  usePageTitle('Conta');
  const { data } = useSession();
  const logoutAll = useLogoutAll();
  const [confirming, setConfirming] = useState(false);
  if (!data) return null;
  const { user, session } = data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeading>Conta</PageHeading>

      <section aria-labelledby="dados-da-conta" className="flex flex-col gap-3">
        <h2 id="dados-da-conta" className="text-lg font-semibold">
          Dados da conta
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-base sm:grid-cols-[12rem_1fr]">
          <dt className="font-medium text-slate-700">Nome</dt>
          <dd>{user.displayName ?? 'Não informado'}</dd>
          <dt className="font-medium text-slate-700">E-mail</dt>
          <dd className="break-all">{user.email}</dd>
        </dl>
      </section>

      <section aria-labelledby="seguranca" className="flex flex-col gap-3">
        <h2 id="seguranca" className="text-lg font-semibold">
          Segurança da sessão
        </h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-base sm:grid-cols-[12rem_1fr]">
          <dt className="font-medium text-slate-700">Sessão válida até</dt>
          <dd>{formatDate(session.expiresAt)}</dd>
          <dt className="font-medium text-slate-700">Limite máximo</dt>
          <dd>{formatDate(session.absoluteExpiresAt)}</dd>
        </dl>
        <p className="text-sm text-slate-700">
          A validade da sessão é renovada enquanto você usa o serviço, até o limite máximo.
        </p>

        {logoutAll.isError ? (
          <Alert tone="error" title="Não foi possível encerrar as sessões">
            {messageForError(logoutAll.error)}
          </Alert>
        ) : null}

        {confirming ? (
          <div
            role="group"
            aria-labelledby="confirmar-sair-todos"
            className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4"
          >
            <p id="confirmar-sair-todos" className="text-base font-medium">
              Sair de todos os dispositivos?
            </p>
            <p className="text-sm text-slate-700">
              Todas as sessões desta conta, inclusive esta, serão encerradas e você precisará entrar
              novamente.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="danger"
                disabled={logoutAll.isPending}
                onClick={() => {
                  logoutAll.mutate();
                }}
              >
                {logoutAll.isPending ? 'Encerrando…' : 'Confirmar e sair de tudo'}
              </Button>
              <Button
                variant="secondary"
                disabled={logoutAll.isPending}
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(true);
              }}
            >
              Sair de todos os dispositivos
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
