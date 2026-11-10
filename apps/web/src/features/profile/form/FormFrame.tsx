import { useEffect, useId, useRef, useState, type FormEventHandler, type ReactNode } from 'react';
import { get, useFormContext } from 'react-hook-form';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { leafFields, type FieldGroup, type FormSpec } from '../field-defs';
import { FieldRenderer } from './FieldRenderer';
import { errorMessageAt, FORM_ERROR_KEY, getPath, prune } from './form-utils';

function GroupSection({ group }: { group: FieldGroup }) {
  const { formState, getValues } = useFormContext();
  const names = leafFields({ groups: [group] }).map((leaf) => leaf.name);
  const hasError = names.some((name) => get(formState.errors, name) !== undefined);
  // Grupos recolhidos abrem sozinhos quando ja tem conteudo (edicao) ou quando tem erro.
  const [open, setOpen] = useState(
    () =>
      group.open === true || names.some((name) => prune(getPath(getValues(), name)) !== undefined),
  );
  const id = useId();

  const body = (
    <div className="flex flex-col gap-4">
      {group.description !== undefined ? (
        <p className="text-sm text-slate-700">{group.description}</p>
      ) : null}
      {group.fields.map((field) => (
        <FieldRenderer key={field.name} def={field} />
      ))}
    </div>
  );

  if (group.open === true) {
    return (
      <section aria-labelledby={id} className="flex flex-col gap-3">
        <h3 id={id} className="text-base font-semibold text-slate-900">
          {group.title}
        </h3>
        {body}
      </section>
    );
  }
  return (
    <details
      open={open || hasError}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
      className="rounded-md border border-slate-300 bg-white"
    >
      <summary className="cursor-pointer px-4 py-3 text-base font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700">
        {group.title}
      </summary>
      <div className="border-t border-slate-300 p-4">{body}</div>
    </details>
  );
}

export interface FormFrameProps {
  title: string;
  spec: FormSpec;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancel: () => void;
  submitLabel: string;
  cancelLabel?: string;
  pending: boolean;
  /** Erro vindo da API (texto ja em pt-BR). */
  apiError?: string | undefined;
  /** Blocos extras entre os grupos e os botoes (governanca, estados de campo). */
  extra?: ReactNode;
}

/**
 * Moldura comum dos formularios do perfil: titulo que recebe foco, grupos progressivos (so o
 * essencial aberto), erro do formulario inteiro e botoes. Nao conhece o tipo do registro.
 */
export function FormFrame({
  title,
  spec,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel = 'Cancelar',
  pending,
  apiError,
  extra,
}: FormFrameProps) {
  const { formState } = useFormContext();
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const formError = errorMessageAt(formState.errors, FORM_ERROR_KEY);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <form
      aria-labelledby={titleId}
      noValidate
      onSubmit={onSubmit}
      className="flex flex-col gap-5 rounded-md border border-slate-400 bg-white p-4 sm:p-5"
    >
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-slate-900 focus:outline-none"
      >
        {title}
      </h2>
      <p className="text-sm text-slate-700">Só os campos com * são obrigatórios.</p>
      {formError !== undefined ? <Alert tone="error">{formError}</Alert> : null}
      {apiError !== undefined ? (
        <Alert tone="error" title="Não foi possível salvar">
          {apiError}
        </Alert>
      ) : null}
      {spec.groups.map((group) => (
        <GroupSection key={group.id} group={group} />
      ))}
      {extra}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-3 border-t border-slate-300 bg-white px-4 py-3 sm:-mx-5 sm:px-5">
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : submitLabel}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </form>
  );
}
