import { Disclosure } from '../../components/ui/Disclosure';
import { useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { usePageTitle } from '../../components/layout/PageHeading';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { messageForError } from '../../lib/api';
import { useLogoutAll, useSession } from '../auth/session';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormatter.format(date);
}

const listClass = 'grid grid-cols-1 gap-x-6 gap-y-1 text-body sm:grid-cols-[10rem_1fr]';

export function AccountPage() {
  usePageTitle('Conta');
  const { data } = useSession();
  const logoutAll = useLogoutAll();
  const [confirming, setConfirming] = useState(false);
  if (!data) return null;
  const { user, session } = data;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Conta" />

      <Section id="dados-da-conta" title="Dados da conta">
        <dl className={listClass}>
          <dt className="text-ink-2">Nome</dt>
          <dd className="font-medium">{user.displayName ?? 'Não informado'}</dd>
          <dt className="text-ink-2">E-mail</dt>
          <dd className="break-all font-medium">{user.email}</dd>
        </dl>
      </Section>

      <Section
        id="aparencia"
        title="Aparência"
        description="Claro, escuro ou igual ao sistema. Atalho: Ctrl+Shift+L."
      >
        <div>
          <ThemeToggle />
        </div>
      </Section>

      <Section id="seguranca" title="Segurança da sessão">
        <dl className={listClass}>
          <dt className="text-ink-2">Sessão válida até</dt>
          <dd className="font-medium">{formatDate(session.expiresAt)}</dd>
        </dl>
        <div className="text-body text-ink-2">
          <Disclosure variant="inline" summary="Detalhes da validade">
            <dl className={`${listClass} mt-2`}>
              <dt>Limite máximo</dt>
              <dd>{formatDate(session.absoluteExpiresAt)}</dd>
            </dl>
            <p className="mt-1">
              A validade é renovada enquanto você usa o serviço, até o limite máximo.
            </p>
          </Disclosure>
        </div>

        {logoutAll.isError ? (
          <Alert tone="error" title="Não foi possível encerrar as sessões">
            {messageForError(logoutAll.error)}
          </Alert>
        ) : null}

        {confirming ? (
          <div
            role="group"
            aria-labelledby="confirmar-sair-todos"
            className="flex flex-col gap-3 rounded-control border border-line-strong bg-surface p-4"
          >
            <p id="confirmar-sair-todos" className="text-body font-medium">
              Sair de todos os dispositivos?
            </p>
            <p className="text-body text-ink-2">
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
      </Section>
    </div>
  );
}
