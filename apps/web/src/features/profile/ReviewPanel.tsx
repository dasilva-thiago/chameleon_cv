import { MAX_CONFIRM_BATCH, isFactKind, type RecordKind } from '@chameleon/contracts';
import { useState } from 'react';
import { Link } from 'react-router';
import { usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CheckboxField } from '../../components/ui/CheckboxField';
import { messageForError } from '../../lib/api';
import { useProfileData } from './context';
import { describeRecord, statusOf } from './document';
import { RECORD_KIND_LABELS } from './labels';
import { useConfirmRecords } from './queries';
import { slugForKind } from './sections';

const SKIP_TEXT = {
  not_found: 'não foi encontrado',
  not_a_fact: 'não é um item confirmável',
  not_needs_review: 'já não estava aguardando revisão',
} as const;

/**
 * Confirmacao em lote com selecao EXPLICITA: a pessoa marca item a item (ou um grupo inteiro de uma
 * vez, ainda por escolha) e confirma so os marcados. Nao existe "confirmar tudo" implicito.
 */
export function ReviewPanel() {
  usePageTitle('Revisar: para confirmar');
  const { index } = useProfileData();
  const confirm = useConfirmRecords();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const pending = index.all.filter(
    (record) => isFactKind(record.kind) && statusOf(record.value) === 'needs_review',
  );
  const groups = new Map<RecordKind, typeof pending>();
  for (const record of pending) {
    groups.set(record.kind, [...(groups.get(record.kind) ?? []), record]);
  }
  // Ids que sumiram da lista (por exemplo, ja confirmados) saem da selecao.
  const effective = new Set(
    [...selected].filter((id) => pending.some((record) => record.id === id)),
  );
  const tooMany = effective.size > MAX_CONFIRM_BATCH;

  const toggle = (id: string, checked: boolean): void => {
    const next = new Set(effective);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const toggleGroup = (ids: string[], checked: boolean): void => {
    const next = new Set(effective);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  const submit = (): void => {
    confirm.mutate([...effective], {
      onSuccess: () => {
        setSelected(new Set());
      },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-slate-700">
        Só itens <strong>confirmados</strong> sustentam afirmações em currículos. Marque os que você
        revisou: ao confirmar, você declara que estão corretos.
      </p>

      <div role="status" aria-live="polite">
        {confirm.isSuccess ? (
          <Alert tone="success">
            {confirm.data.confirmed.length === 1
              ? '1 item confirmado.'
              : `${String(confirm.data.confirmed.length)} itens confirmados.`}
            {confirm.data.skipped.length > 0 ? (
              <>
                {' '}
                {String(confirm.data.skipped.length)} não foram alterados:{' '}
                {[...new Set(confirm.data.skipped.map((skip) => SKIP_TEXT[skip.reason]))].join(
                  '; ',
                )}
                .
              </>
            ) : null}
          </Alert>
        ) : null}
      </div>
      {confirm.isError ? (
        <Alert tone="error" title="Não foi possível confirmar">
          {messageForError(confirm.error)}
        </Alert>
      ) : null}

      {pending.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-400 bg-white p-4 text-base text-slate-800">
          Nenhum item aguardando confirmação no momento.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-5">
            {[...groups.entries()].map(([kind, records]) => {
              const ids = records.map((record) => record.id);
              const allSelected = ids.every((id) => effective.has(id));
              const slug = slugForKind(kind);
              return (
                <fieldset
                  key={kind}
                  className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4"
                >
                  <legend className="px-1 text-base font-semibold text-slate-900">
                    {RECORD_KIND_LABELS[kind]} ({records.length})
                  </legend>
                  <div>
                    <button
                      type="button"
                      className="min-h-11 text-sm font-medium text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                      onClick={() => {
                        toggleGroup(ids, !allSelected);
                      }}
                    >
                      {allSelected
                        ? 'Limpar seleção'
                        : `Selecionar todos (${String(records.length)})`}
                      <span className="sr-only"> de {RECORD_KIND_LABELS[kind].toLowerCase()}</span>
                    </button>
                  </div>
                  <ul className="flex flex-col gap-3">
                    {records.map((record) => {
                      const { title, subtitle } = describeRecord(kind, record.value, index);
                      return (
                        <li
                          key={record.id}
                          className="flex flex-wrap items-start justify-between gap-2"
                        >
                          <CheckboxField
                            label={title}
                            description={subtitle}
                            checked={effective.has(record.id)}
                            onChange={(event) => {
                              toggle(record.id, event.target.checked);
                            }}
                          />
                          {slug !== undefined ? (
                            <Link
                              to={`/perfil/${slug}`}
                              aria-label={`Ver ${title} na seção`}
                              className="text-sm font-medium text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                            >
                              Ver na seção
                            </Link>
                          ) : (
                            <Badge>Sem seção própria</Badge>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              );
            })}
          </div>
          <div className="sticky bottom-0 flex flex-col gap-2 border-t border-slate-300 bg-slate-50 py-3">
            {tooMany ? (
              <p className="text-sm font-medium text-red-800">
                Selecione no máximo {String(MAX_CONFIRM_BATCH)} itens por vez.
              </p>
            ) : null}
            <div>
              <Button
                disabled={effective.size === 0 || tooMany || confirm.isPending}
                onClick={submit}
              >
                {confirm.isPending
                  ? 'Confirmando…'
                  : effective.size === 0
                    ? 'Confirmar itens selecionados'
                    : effective.size === 1
                      ? 'Confirmar 1 item selecionado'
                      : `Confirmar ${String(effective.size)} itens selecionados`}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
