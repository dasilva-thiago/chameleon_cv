import type { RecordKind } from '@chameleon/contracts';
import { useRef, useState, type ReactNode } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { idOf, type Json } from './document';
import { RecordForm } from './form/RecordForm';
import { RECORD_KIND_LABELS } from './labels';
import { RecordCard } from './RecordCard';

type Mode = { type: 'idle' } | { type: 'create' } | { type: 'edit'; id: string };

export interface RecordCollectionProps {
  kind: RecordKind;
  records: readonly Json[];
  /** Pai de registros aninhados. */
  parentId?: string | undefined;
  emptyText: string;
  addLabel: string;
  /** Nivel dos titulos dos cartoes (h3 na pagina da secao; h5 dentro de um cartao). */
  level?: 2 | 4;
  /** Conteudo recolhido de cada cartao (itens filhos, usos de competencia...). */
  extrasFor?: (record: Json, id: string) => { summary: string; content: ReactNode } | undefined;
  deleteHint?: string;
  /** Rotulo para acessibilidade da lista. */
  listLabel: string;
  /** Mensagem fixa exibida acima da lista (por exemplo, orientacao da secao). */
  intro?: ReactNode;
}

/**
 * Lista + criacao + edicao de registros de um tipo. Um unico editor fica aberto por vez; ao salvar,
 * o foco volta ao botao que o abriu e uma mensagem de status confirma a gravacao.
 */
export function RecordCollection({
  kind,
  records,
  parentId,
  emptyText,
  addLabel,
  level = 2,
  extrasFor,
  deleteHint,
  listLabel,
  intro,
}: RecordCollectionProps) {
  const [mode, setMode] = useState<Mode>({ type: 'idle' });
  const [notice, setNotice] = useState<string | undefined>();
  const addRef = useRef<HTMLButtonElement>(null);
  const noun = RECORD_KIND_LABELS[kind];

  const close = (message?: string): void => {
    setMode({ type: 'idle' });
    setNotice(message);
    requestAnimationFrame(() => addRef.current?.focus());
  };

  return (
    <div className="flex flex-col gap-4">
      {intro}
      <div role="status" aria-live="polite">
        {notice !== undefined ? <Alert tone="success">{notice}</Alert> : null}
      </div>

      {mode.type !== 'create' ? (
        <div>
          <Button
            ref={addRef}
            variant={records.length === 0 ? 'primary' : 'secondary'}
            onClick={() => {
              setNotice(undefined);
              setMode({ type: 'create' });
            }}
          >
            {addLabel}
          </Button>
        </div>
      ) : null}

      {records.length === 0 && mode.type !== 'create' ? (
        <p className="rounded-md border border-dashed border-slate-400 bg-white p-4 text-base text-slate-800">
          {emptyText}
        </p>
      ) : null}

      {records.length > 0 ? (
        <ul aria-label={listLabel} className="flex flex-col gap-3">
          {records.map((record) => {
            const id = idOf(record);
            if (id === undefined) return null;
            const editing = mode.type === 'edit' && mode.id === id;
            return (
              <li key={id}>
                {editing ? (
                  <RecordForm
                    kind={kind}
                    record={record}
                    recordId={id}
                    title={`Editar ${noun.toLowerCase()}`}
                    onSaved={() => {
                      close(`${noun} salvo(a).`);
                    }}
                    onCancel={() => {
                      close();
                    }}
                  />
                ) : (
                  <RecordCard
                    kind={kind}
                    id={id}
                    record={record}
                    level={level}
                    extras={extrasFor?.(record, id)}
                    deleteHint={deleteHint}
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
      ) : null}

      {mode.type === 'create' ? (
        <RecordForm
          kind={kind}
          parentId={parentId}
          title={addLabel}
          onSaved={() => {
            close(`${noun} adicionado(a).`);
          }}
          onCancel={() => {
            close();
          }}
        />
      ) : null}
    </div>
  );
}
