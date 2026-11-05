import { useRef, useState } from 'react';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { SelectField } from '../../components/ui/SelectField';
import { messageForError } from '../../lib/api';
import { useProfileData } from './context';
import { describeRecord, idOf, isJson, type Json } from './document';
import { RecordForm } from './form/RecordForm';
import {
  PENDING_REASON_LABELS,
  PENDING_STATUS_LABELS,
  PRIORITY_LABELS,
  RECORD_KIND_LABELS,
} from './labels';
import { usePatchPending, usePendingList, type PendingFilter } from './queries';
import { slugForKind } from './sections';
import { Link } from 'react-router';
import type { PendingEntry } from '@chameleon/contracts';

const FILTERS: { value: PendingFilter; label: string }[] = [
  { value: 'open', label: 'Abertas' },
  { value: 'resolved', label: 'Resolvidas' },
  { value: 'dismissed', label: 'Dispensadas' },
  { value: 'all', label: 'Todas' },
];

const NEXT_ACTIONS: Record<string, { status: 'open' | 'resolved' | 'dismissed'; label: string }[]> =
  {
    open: [
      { status: 'resolved', label: 'Marcar como resolvida' },
      { status: 'dismissed', label: 'Dispensar' },
    ],
    resolved: [{ status: 'open', label: 'Reabrir' }],
    dismissed: [{ status: 'open', label: 'Reabrir' }],
  };

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

function PendingCard({ entry, onEdit }: { entry: PendingEntry; onEdit: () => void }) {
  const { index } = useProfileData();
  const patch = usePatchPending();
  const record = entry.record as Json;
  const id = idOf(record);
  const status = str(record.status) ?? 'open';
  const reason = str(record.reason);
  const priority = str(record.priority);
  const target = isJson(record.target) ? record.target : {};
  const targetId = str(target.record_id)?.toLowerCase();
  const targetRecord = targetId !== undefined ? index.byId.get(targetId) : undefined;
  const slug = targetRecord ? slugForKind(targetRecord.kind) : undefined;
  const subject = str(record.subject) ?? 'Pendência sem assunto';

  return (
    <article className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{subject}</h2>
      <div className="flex flex-wrap gap-2">
        <Badge tone={status === 'open' ? 'warn' : 'neutral'} prefix="Situação">
          {PENDING_STATUS_LABELS[status as keyof typeof PENDING_STATUS_LABELS] ?? status}
        </Badge>
        {reason !== undefined && reason in PENDING_REASON_LABELS ? (
          <Badge prefix="Motivo">
            {PENDING_REASON_LABELS[reason as keyof typeof PENDING_REASON_LABELS]}
          </Badge>
        ) : null}
        {priority !== undefined && priority in PRIORITY_LABELS ? (
          <Badge prefix="Prioridade">
            {PRIORITY_LABELS[priority as keyof typeof PRIORITY_LABELS]}
          </Badge>
        ) : null}
      </div>
      {targetRecord ? (
        <p className="text-sm text-slate-800">
          <span className="font-medium">Refere-se a:</span> {RECORD_KIND_LABELS[targetRecord.kind]}{' '}
          — {describeRecord(targetRecord.kind, targetRecord.value, index).title}
          {slug !== undefined ? (
            <>
              {' '}
              <Link
                to={`/perfil/${slug}`}
                className="font-medium text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Abrir seção
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {str(record.reason_detail) !== undefined ? (
        <p className="text-sm text-slate-800">{str(record.reason_detail)}</p>
      ) : null}
      {str(record.safe_statement_for_now) !== undefined ? (
        <p className="text-sm text-slate-800">
          <span className="font-medium">Por enquanto pode-se dizer:</span>{' '}
          {str(record.safe_statement_for_now)}
        </p>
      ) : null}
      {str(record.confirmation_method) !== undefined ? (
        <p className="text-sm text-slate-800">
          <span className="font-medium">Como confirmar:</span> {str(record.confirmation_method)}
        </p>
      ) : null}
      {patch.isError ? (
        <Alert tone="error" title="Não foi possível atualizar">
          {messageForError(patch.error)}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {id !== undefined
          ? (NEXT_ACTIONS[status] ?? NEXT_ACTIONS.open ?? []).map((action) => (
              <Button
                key={action.status}
                variant="secondary"
                aria-label={`${action.label}: ${subject}`}
                disabled={patch.isPending}
                onClick={() => {
                  patch.mutate({ id, status: action.status });
                }}
              >
                {action.label}
              </Button>
            ))
          : null}
        <Button variant="secondary" aria-label={`Editar pendência: ${subject}`} onClick={onEdit}>
          Editar
        </Button>
      </div>
    </article>
  );
}

/** Painel de pendencias: o que falta confirmar ou esclarecer. Listar, editar e mudar o estado. */
export function PendingPanel() {
  usePageTitle('Pendências');
  const [filter, setFilter] = useState<PendingFilter>('open');
  const list = usePendingList(filter);
  const [mode, setMode] = useState<
    { type: 'idle' } | { type: 'create' } | { type: 'edit'; id: string }
  >({
    type: 'idle',
  });
  const addRef = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState<string | undefined>();

  const close = (message?: string): void => {
    setMode({ type: 'idle' });
    setNotice(message);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <PageHeading>Pendências</PageHeading>
        <p className="text-base text-slate-800">
          Dúvidas e informações a esclarecer sobre o seu perfil. Elas ajudam a não afirmar nada que
          ainda não foi confirmado.
        </p>
      </div>

      <div className="max-w-xs">
        <SelectField
          label="Mostrar"
          placeholder={null}
          options={FILTERS}
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value as PendingFilter);
          }}
        />
      </div>

      <div role="status" aria-live="polite">
        {notice !== undefined ? <Alert tone="success">{notice}</Alert> : null}
      </div>

      {list.isPending ? <LoadingStatus label="Carregando pendências…" /> : null}
      {list.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error" title="Não foi possível carregar as pendências">
            {messageForError(list.error)}
          </Alert>
          <Button
            onClick={() => {
              void list.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : null}
      {list.isSuccess ? (
        <>
          <p className="text-sm text-slate-700">
            {String(list.data.counts.open)} aberta(s) · {String(list.data.counts.resolved)}{' '}
            resolvida(s) · {String(list.data.counts.dismissed)} dispensada(s)
          </p>
          {list.data.pending.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-400 bg-white p-4 text-base text-slate-800">
              Nenhuma pendência {filter === 'all' ? 'cadastrada' : 'neste filtro'}.
            </p>
          ) : (
            <ul aria-label="Pendências" className="flex flex-col gap-3">
              {list.data.pending.map((entry) => {
                const id = idOf(entry.record);
                if (id === undefined) return null;
                return (
                  <li key={id}>
                    {mode.type === 'edit' && mode.id === id ? (
                      <RecordForm
                        kind="pending_item"
                        record={entry.record}
                        recordId={id}
                        title="Editar pendência"
                        onSaved={() => {
                          close('Pendência salva.');
                        }}
                        onCancel={() => {
                          close();
                        }}
                      />
                    ) : (
                      <PendingCard
                        entry={entry}
                        onEdit={() => {
                          setNotice(undefined);
                          setMode({ type: 'edit', id });
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}

      {mode.type === 'create' ? (
        <RecordForm
          kind="pending_item"
          title="Nova pendência"
          onSaved={() => {
            close('Pendência registrada.');
          }}
          onCancel={() => {
            close();
          }}
        />
      ) : (
        <div>
          <Button
            ref={addRef}
            variant="secondary"
            onClick={() => {
              setNotice(undefined);
              setMode({ type: 'create' });
            }}
          >
            Registrar pendência
          </Button>
        </div>
      )}
    </div>
  );
}
