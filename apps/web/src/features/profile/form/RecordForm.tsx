import { PROFILE_RECORD_SCHEMAS, isFactKind, type RecordKind } from '@chameleon/contracts';
import { useMemo, useState } from 'react';
import { FormProvider, useForm, type FieldValues } from 'react-hook-form';
import { messageForError } from '../../../lib/api';
import type { Json } from '../document';
import { RECORD_FORMS } from '../field-defs';
import { useCreateRecord, useReplaceRecord } from '../queries';
import { FieldStatesPanel } from './FieldStatesPanel';
import { FormEnvProvider } from './FieldRenderer';
import { FormFrame } from './FormFrame';
import { contractResolver, pruneRecord, toFormValues } from './form-utils';
import { GovernanceFields, NEW_FACT_META } from './GovernanceFields';

export interface RecordFormProps {
  kind: RecordKind;
  /** Registro existente (edicao). Ausente = criacao. */
  record?: Json | undefined;
  recordId?: string | undefined;
  /** Pai de registros aninhados (item de experiencia, de projeto, colaborador). */
  parentId?: string | undefined;
  title: string;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Formulario generico de um registro, dirigido por `RECORD_FORMS[kind]` e validado pelo schema do
 * contrato. Na criacao, o registro nasce com origem `form_entry` e a pessoa escolhe ja ali se
 * confirma, quem pode ver e se pode ir a currículos (ADR-0005). Na edicao, a governanca existente
 * e preservada; ela muda pelos controles do cartao do item.
 */
export function RecordForm({
  kind,
  record,
  recordId,
  parentId,
  title,
  onSaved,
  onCancel,
}: RecordFormProps) {
  const spec = RECORD_FORMS[kind];
  const governed = isFactKind(kind);
  const editing = record !== undefined && recordId !== undefined;
  const create = useCreateRecord();
  const replace = useReplaceRecord();
  const [apiError, setApiError] = useState<string | undefined>();

  const resolver = useMemo(
    () => (spec ? contractResolver(PROFILE_RECORD_SCHEMAS[kind], spec) : undefined),
    [kind, spec],
  );
  const defaultValues = useMemo<FieldValues>(
    () => (editing ? toFormValues(record) : governed ? { meta: { ...NEW_FACT_META } } : {}),
    [editing, record, governed],
  );
  const form = useForm<FieldValues>({ defaultValues, ...(resolver ? { resolver } : {}) });

  if (!spec) return null;

  const submit = form.handleSubmit(async (values) => {
    setApiError(undefined);
    const payload = pruneRecord(values);
    try {
      if (editing) await replace.mutateAsync({ id: recordId, record: payload });
      else await create.mutateAsync({ kind, ...(parentId ? { parentId } : {}), record: payload });
      onSaved();
    } catch (error) {
      setApiError(messageForError(error));
    }
  });

  return (
    <FormProvider {...form}>
      <FormEnvProvider value={{ statesPath: governed ? 'meta.field_states' : null }}>
        <FormFrame
          title={title}
          spec={spec}
          onSubmit={(event) => {
            void submit(event);
          }}
          onCancel={onCancel}
          submitLabel={editing ? 'Salvar alterações' : 'Salvar'}
          pending={create.isPending || replace.isPending}
          apiError={apiError}
          extra={
            <>
              {governed ? <FieldStatesPanel spec={spec} statesPath="meta.field_states" /> : null}
              {governed && !editing ? (
                <fieldset className="flex flex-col gap-3 rounded-md border border-slate-300 p-4">
                  <legend className="px-1 text-sm font-semibold text-slate-900">
                    Situação e uso deste item
                  </legend>
                  <p className="text-sm text-slate-700">
                    Você decide agora se já confirma estas informações e como elas podem ser usadas.
                    É possível mudar depois.
                  </p>
                  <GovernanceFields />
                </fieldset>
              ) : null}
            </>
          }
        />
      </FormEnvProvider>
    </FormProvider>
  );
}
