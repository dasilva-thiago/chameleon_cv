import { isFactKind, type EvidenceEntry } from '@chameleon/contracts';
import { useRef, useState } from 'react';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { SelectField } from '../../components/ui/SelectField';
import { messageForError } from '../../lib/api';
import { useProfileData } from './context';
import { describeRecord, idOf, type Json } from './document';
import { RecordForm } from './form/RecordForm';
import { RECORD_KIND_LABELS } from './labels';
import { useEvidenceList, useLinkEvidence, useUnlinkEvidence } from './queries';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

function EvidenceCard({ entry, onEdit }: { entry: EvidenceEntry; onEdit: () => void }) {
  const { index } = useProfileData();
  const link = useLinkEvidence();
  const unlink = useUnlinkEvidence();
  const [chosen, setChosen] = useState('');
  const record = entry.record as Json;
  const id = idOf(record);
  const title = str(record.title) ?? str(record.url_or_location) ?? 'Evidência sem título';
  const linked = new Set(entry.links.map((ref) => ref.recordId));
  const options = index.all
    .filter((item) => isFactKind(item.kind) && !linked.has(item.id))
    .map((item) => ({
      value: item.id,
      label: `${RECORD_KIND_LABELS[item.kind]}: ${describeRecord(item.kind, item.value, index).title}`,
    }));
  const busy = link.isPending || unlink.isPending;
  const error = link.error ?? unlink.error;

  return (
    <article className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {str(record.url_or_location) !== undefined && str(record.title) !== undefined ? (
        <p className="break-words text-sm text-slate-800">{str(record.url_or_location)}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Sustenta ({entry.links.length})</h3>
        {entry.links.length === 0 ? (
          <p className="text-sm text-slate-700">Ainda não vinculada a nenhum item.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entry.links.map((ref) => {
              const target = index.byId.get(ref.recordId.toLowerCase());
              const label =
                target !== undefined
                  ? `${RECORD_KIND_LABELS[target.kind]}: ${describeRecord(target.kind, target.value, index).title}`
                  : `${RECORD_KIND_LABELS[ref.kind]} (item não encontrado)`;
              return (
                <li key={ref.recordId} className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge>{label}</Badge>
                  {id !== undefined ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      aria-label={`Desvincular ${label} de ${title}`}
                      onClick={() => {
                        unlink.mutate({ evidenceId: id, recordId: ref.recordId });
                      }}
                    >
                      Desvincular
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {id !== undefined && options.length > 0 ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <SelectField
              label={`Vincular "${title}" a um item`}
              placeholder="Escolha um item"
              options={options}
              value={chosen}
              onChange={(event) => {
                setChosen(event.target.value);
              }}
            />
          </div>
          <Button
            disabled={chosen === '' || busy}
            onClick={() => {
              link.mutate(
                { evidenceId: id, recordId: chosen },
                {
                  onSuccess: () => {
                    setChosen('');
                  },
                },
              );
            }}
          >
            Vincular
          </Button>
        </div>
      ) : null}

      {error !== null ? (
        <Alert tone="error" title="Não foi possível atualizar os vínculos">
          {messageForError(error)}
        </Alert>
      ) : null}
      <div>
        <Button variant="secondary" aria-label={`Editar evidência: ${title}`} onClick={onEdit}>
          Editar
        </Button>
      </div>
    </article>
  );
}

/** Evidencias de apoio (links, documentos) e os fatos do perfil que cada uma sustenta. */
export function EvidencePanel() {
  usePageTitle('Evidências');
  const list = useEvidenceList();
  const [mode, setMode] = useState<
    { type: 'idle' } | { type: 'create' } | { type: 'edit'; id: string }
  >({ type: 'idle' });
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
        <PageHeading>Evidências</PageHeading>
        <p className="text-base text-slate-800">
          Links, documentos e referências que comprovam o que está no seu perfil. Vincule cada
          evidência aos itens que ela sustenta.
        </p>
      </div>

      <div role="status" aria-live="polite">
        {notice !== undefined ? <Alert tone="success">{notice}</Alert> : null}
      </div>

      {list.isPending ? <LoadingStatus label="Carregando evidências…" /> : null}
      {list.isError ? (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error" title="Não foi possível carregar as evidências">
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
        list.data.evidence.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-400 bg-white p-4 text-base text-slate-800">
            Nenhuma evidência cadastrada ainda.
          </p>
        ) : (
          <ul aria-label="Evidências" className="flex flex-col gap-3">
            {list.data.evidence.map((entry) => {
              const id = idOf(entry.record);
              if (id === undefined) return null;
              return (
                <li key={id}>
                  {mode.type === 'edit' && mode.id === id ? (
                    <RecordForm
                      kind="evidence"
                      record={entry.record}
                      recordId={id}
                      title="Editar evidência"
                      onSaved={() => {
                        close('Evidência salva.');
                      }}
                      onCancel={() => {
                        close();
                      }}
                    />
                  ) : (
                    <EvidenceCard
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
        )
      ) : null}

      {mode.type === 'create' ? (
        <RecordForm
          kind="evidence"
          title="Nova evidência"
          onSaved={() => {
            close('Evidência cadastrada.');
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
            Cadastrar evidência
          </Button>
        </div>
      )}
    </div>
  );
}
