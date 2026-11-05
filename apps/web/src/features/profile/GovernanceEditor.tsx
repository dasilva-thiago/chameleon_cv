import {
  FACT_STATUS_VALUES,
  RESUME_USE_VALUES,
  VISIBILITY_VALUES,
  type FactStatus,
  type PatchRecordMetaRequest,
  type ResumeUse,
  type Visibility,
} from '@chameleon/contracts';
import { useId, useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/SelectField';
import { messageForError } from '../../lib/api';
import { resumeUseOf, statusOf, visibilityOf, type Json } from './document';
import {
  RESUME_USE_HELP,
  RESUME_USE_LABELS,
  STATUS_HELP,
  STATUS_LABELS,
  VISIBILITY_HELP,
  VISIBILITY_LABELS,
  optionsOf,
} from './labels';
import { usePatchMeta } from './queries';

/**
 * Controles explicitos de status, visibilidade e uso em currículos de UM fato existente
 * (`PATCH /records/:id/meta`). Nada muda ate a pessoa clicar em "Aplicar"; arquivar implica
 * "nunca usar" (regra do contrato), e o controle de uso fica travado nesse caso.
 */
export function GovernanceEditor({
  recordId,
  record,
  onApplied,
}: {
  recordId: string;
  record: Json;
  onApplied?: () => void;
}) {
  const patch = usePatchMeta();
  const baseStatus = statusOf(record);
  const baseVisibility = visibilityOf(record);
  const baseUse = resumeUseOf(record);
  const [status, setStatus] = useState<FactStatus>(baseStatus);
  const [visibility, setVisibility] = useState<Visibility | ''>(baseVisibility ?? '');
  const [resumeUse, setResumeUse] = useState<ResumeUse | ''>(baseUse ?? '');
  const [done, setDone] = useState(false);
  const formId = useId();

  const archived = status === 'archived';
  const effectiveUse: ResumeUse | '' = archived ? 'never' : resumeUse;

  const apply = (): void => {
    const body: PatchRecordMetaRequest = {};
    if (status !== baseStatus) body.status = status;
    if (visibility !== '' && visibility !== baseVisibility) body.visibility = visibility;
    if (effectiveUse !== '' && effectiveUse !== baseUse) body.resume_use = effectiveUse;
    if (Object.keys(body).length === 0) {
      setDone(true);
      return;
    }
    setDone(false);
    patch.mutate(
      { id: recordId, patch: body },
      {
        onSuccess: () => {
          setDone(true);
          onApplied?.();
        },
      },
    );
  };

  return (
    <div
      role="group"
      aria-labelledby={`${formId}-title`}
      className="flex flex-col gap-4 rounded-md border border-slate-300 bg-slate-50 p-4"
    >
      <p id={`${formId}-title`} className="text-sm font-semibold text-slate-900">
        Situação e uso deste item
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Situação"
          placeholder={null}
          options={optionsOf(FACT_STATUS_VALUES, STATUS_LABELS)}
          hint={STATUS_HELP[status]}
          value={status}
          onChange={(event) => {
            setDone(false);
            setStatus(event.target.value as FactStatus);
          }}
        />
        <SelectField
          label="Quem pode ver"
          placeholder="Sem regra definida"
          options={optionsOf(VISIBILITY_VALUES, VISIBILITY_LABELS)}
          hint={visibility !== '' ? VISIBILITY_HELP[visibility] : 'Ainda sem regra definida.'}
          value={visibility}
          onChange={(event) => {
            setDone(false);
            setVisibility(event.target.value as Visibility | '');
          }}
        />
        <SelectField
          label="Uso em currículos"
          placeholder="Sem regra definida"
          options={optionsOf(RESUME_USE_VALUES, RESUME_USE_LABELS)}
          hint={
            archived
              ? 'Itens arquivados nunca são usados em currículos.'
              : effectiveUse !== ''
                ? RESUME_USE_HELP[effectiveUse]
                : 'Ainda sem regra definida.'
          }
          value={effectiveUse}
          disabled={archived}
          onChange={(event) => {
            setDone(false);
            setResumeUse(event.target.value as ResumeUse | '');
          }}
        />
      </div>
      {patch.isError ? (
        <Alert tone="error" title="Não foi possível aplicar">
          {messageForError(patch.error)}
        </Alert>
      ) : null}
      {done ? <Alert tone="success">Alterações aplicadas.</Alert> : null}
      <div>
        <Button variant="secondary" disabled={patch.isPending} onClick={apply}>
          {patch.isPending ? 'Aplicando…' : 'Aplicar alterações'}
        </Button>
      </div>
    </div>
  );
}
