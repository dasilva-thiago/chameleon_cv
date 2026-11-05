import { profileSectionValueSchema, type ProfileSection } from '@chameleon/contracts';
import { useMemo, useState } from 'react';
import { FormProvider, useForm, type FieldValues } from 'react-hook-form';
import { messageForError } from '../../../lib/api';
import type { Json } from '../document';
import type { FormSpec } from '../field-defs';
import { useSaveSection } from '../queries';
import { FieldStatesPanel } from './FieldStatesPanel';
import { FormEnvProvider } from './FieldRenderer';
import { FormFrame } from './FormFrame';
import { contractResolver, prune, toFormValues } from './form-utils';

/**
 * Formulario de um bloco singleton (identidade, preferencias...). Salva o bloco inteiro pela
 * rota de secao; bloco sem nenhum valor e salvo como "nao informado" (`null`), nunca como `{}`.
 */
export function BlockForm({
  section,
  spec,
  value,
  title,
  onSaved,
}: {
  section: ProfileSection;
  spec: FormSpec;
  value: Json | null;
  title: string;
  onSaved: () => void;
}) {
  const save = useSaveSection();
  const [apiError, setApiError] = useState<string | undefined>();
  const resolver = useMemo(
    () => contractResolver(profileSectionValueSchema(section), spec),
    [section, spec],
  );
  const defaultValues = useMemo<FieldValues>(() => toFormValues(value ?? undefined), [value]);
  const form = useForm<FieldValues>({ defaultValues, resolver });

  const submit = form.handleSubmit(async (values) => {
    setApiError(undefined);
    try {
      await save.mutateAsync({ section, value: prune(values) ?? null });
      onSaved();
    } catch (error) {
      setApiError(messageForError(error));
    }
  });

  return (
    <FormProvider {...form}>
      <FormEnvProvider value={{ statesPath: 'field_states' }}>
        <FormFrame
          title={title}
          spec={spec}
          onSubmit={(event) => {
            void submit(event);
          }}
          onCancel={() => {
            form.reset(defaultValues);
            setApiError(undefined);
          }}
          cancelLabel="Desfazer alterações"
          submitLabel="Salvar seção"
          pending={save.isPending}
          apiError={apiError}
          extra={<FieldStatesPanel spec={spec} statesPath="field_states" />}
        />
      </FormEnvProvider>
    </FormProvider>
  );
}
