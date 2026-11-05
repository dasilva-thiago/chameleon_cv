import { createContext, useContext, useEffect, useState, type ReactNode, type Ref } from 'react';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import { CheckboxField } from '../../../components/ui/CheckboxField';
import { SelectField } from '../../../components/ui/SelectField';
import { TextAreaField } from '../../../components/ui/TextAreaField';
import { TextField } from '../../../components/ui/TextField';
import { useProfileData } from '../context';
import { describeRecord } from '../document';
import type { FieldDef } from '../field-defs';
import { blankToNull, boolOrNull, errorMessageAt, numberOrNull } from './form-utils';

/** Onde ficam os estados explicitos de campo (`field_states`) neste formulario, se houver. */
export interface FormEnv {
  statesPath: string | null;
}

const FormEnvContext = createContext<FormEnv>({ statesPath: null });
export const FormEnvProvider = FormEnvContext.Provider;

/** Estados que dizem "nao ha valor": o contrato proibe valor preenchido junto com eles. */
const STATES_WITHOUT_VALUE = new Set(['not_applicable', 'declined', 'not_assessed']);

function useStateOf(fullName: string): string | undefined {
  const { statesPath } = useContext(FormEnvContext);
  const states = useWatch({ name: statesPath ?? '__no_states__' }) as unknown;
  if (statesPath === null || typeof states !== 'object' || states === null) return undefined;
  const state = (states as Record<string, unknown>)[fullName];
  return typeof state === 'string' ? state : undefined;
}

function useErrorMessage(name: string): string | undefined {
  const {
    formState: { errors },
  } = useFormContext();
  return errorMessageAt(errors, name);
}

function hintOf(def: { hint?: string; private?: boolean }, state: string | undefined): ReactNode {
  const parts: string[] = [];
  if (def.private === true) parts.push('Privado: nunca vai para currículos.');
  if (def.hint !== undefined) parts.push(def.hint);
  if (state === 'needs_confirmation') parts.push('Marcado: este valor precisa ser confirmado.');
  if (state !== undefined && STATES_WITHOUT_VALUE.has(state)) {
    parts.push('Marcado como sem valor; para preencher, remova a marca em "Estados dos campos".');
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

interface LeafProps<T extends FieldDef> {
  def: T;
  /** Nome completo do campo no formulario (com o prefixo do grupo). */
  name: string;
}

function TextInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'text' }>>) {
  const error = useErrorMessage(name);
  const { register } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  const input = def.input ?? 'text';
  return (
    <TextField
      label={def.label}
      hint={hintOf(def, state)}
      error={error}
      required={def.required}
      type={input === 'tel' ? 'tel' : 'text'}
      inputMode={input === 'url' ? 'url' : input === 'email' ? 'email' : undefined}
      autoComplete="off"
      {...register(name, { disabled })}
    />
  );
}

function TextAreaInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'textarea' }>>) {
  const error = useErrorMessage(name);
  const { register } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  return (
    <TextAreaField
      label={def.label}
      hint={hintOf(def, state)}
      error={error}
      required={def.required}
      rows={def.rows ?? 3}
      {...register(name, { disabled })}
    />
  );
}

function SelectInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'select' }>>) {
  const error = useErrorMessage(name);
  const { register, control, getValues, setValue } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  const values = useWatch({ control }) as Record<string, unknown>;
  const options = typeof def.options === 'function' ? def.options(values) : def.options;
  const optionKey = options.map((option) => option.value).join('|');
  const dynamic = typeof def.options === 'function';

  // Opcoes dependentes (ex.: subtipo do contato): descarta a escolha que deixou de valer.
  useEffect(() => {
    if (!dynamic) return;
    const current = getValues(name) as unknown;
    if (typeof current === 'string' && current !== '' && !optionKey.split('|').includes(current)) {
      setValue(name, null);
    }
  }, [dynamic, optionKey, getValues, name, setValue]);

  return (
    <SelectField
      label={def.label}
      hint={hintOf(def, state)}
      error={error}
      required={def.required}
      options={options}
      placeholder={def.required === true ? 'Escolha uma opção' : 'Não informado'}
      {...register(name, { disabled })}
    />
  );
}

function NumberInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'number' }>>) {
  const error = useErrorMessage(name);
  const { register } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  return (
    <TextField
      label={def.label}
      hint={hintOf(def, state)}
      error={error}
      required={def.required}
      inputMode="decimal"
      autoComplete="off"
      {...register(name, { setValueAs: numberOrNull, disabled })}
    />
  );
}

function BooleanInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'boolean' }>>) {
  const error = useErrorMessage(name);
  const { register } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  return (
    <SelectField
      label={def.label}
      hint={hintOf(def, state)}
      error={error}
      options={[
        { value: 'true', label: 'Sim' },
        { value: 'false', label: 'Não' },
      ]}
      {...register(name, { setValueAs: boolOrNull, disabled })}
    />
  );
}

function DateInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'date' }>>) {
  const error = useErrorMessage(name);
  const { register } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  if (def.allowPresent === true) {
    return <PeriodEndInput def={def} name={name} disabled={disabled} state={state} />;
  }
  return (
    <TextField
      label={def.label}
      hint={hintOf(def, state)}
      error={error}
      required={def.required}
      placeholder="AAAA-MM"
      autoComplete="off"
      {...register(name, { disabled })}
    />
  );
}

/** Data de fim com a opcao "Atual" (valor `present` do contrato). */
function PeriodEndInput({
  def,
  name,
  disabled,
  state,
}: LeafProps<Extract<FieldDef, { kind: 'date' }>> & {
  disabled: boolean;
  state: string | undefined;
}) {
  const { control } = useFormContext();
  const error = useErrorMessage(name);
  return (
    <Controller
      control={control}
      name={name}
      disabled={disabled}
      render={({ field }) => {
        const present = field.value === 'present';
        return (
          <div className="flex flex-col gap-2">
            <TextField
              label={def.label}
              hint={hintOf(def, state)}
              error={error}
              placeholder="AAAA-MM"
              autoComplete="off"
              disabled={disabled || present}
              value={present ? '' : typeof field.value === 'string' ? field.value : ''}
              onChange={(event) => {
                field.onChange(blankToNull(event.target.value));
              }}
              onBlur={field.onBlur}
              ref={field.ref}
            />
            <CheckboxField
              label="Atual (ainda em andamento)"
              checked={present}
              disabled={disabled}
              onChange={(event) => {
                field.onChange(event.target.checked ? 'present' : null);
              }}
            />
          </div>
        );
      }}
    />
  );
}

function ListInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'list' }>>) {
  const error = useErrorMessage(name);
  const { control } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ListTextArea
          // Recria o texto quando o valor e limpo por fora (estado de campo).
          key={field.value === null || field.value === undefined ? 'empty' : 'filled'}
          label={def.label}
          hint={hintOf(def, state)}
          error={error}
          disabled={disabled}
          value={field.value as unknown}
          onChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
        />
      )}
    />
  );
}

interface ListTextAreaProps {
  label: string;
  hint: ReactNode;
  error: string | undefined;
  disabled: boolean;
  value: unknown;
  onChange: (items: string[] | null) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLTextAreaElement>;
}

/** Uma linha por item; o texto bruto fica local para nao perder linhas em branco durante a digitacao. */
function ListTextArea({
  label,
  hint,
  error,
  disabled,
  value,
  onChange,
  onBlur,
  inputRef,
}: ListTextAreaProps) {
  const [raw, setRaw] = useState(() => (Array.isArray(value) ? value.join('\n') : ''));
  return (
    <TextAreaField
      label={label}
      hint={hint}
      error={error}
      rows={3}
      disabled={disabled}
      value={raw}
      onChange={(event) => {
        setRaw(event.target.value);
        const items = event.target.value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line !== '');
        onChange(items.length > 0 ? items : null);
      }}
      onBlur={onBlur}
      ref={inputRef}
    />
  );
}

function MultiInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'multi' }>>) {
  const { control } = useFormContext();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  const error = useErrorMessage(name);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const selected = Array.isArray(field.value) ? (field.value as string[]) : [];
        return (
          <fieldset className="flex flex-col gap-2" disabled={disabled}>
            <legend className="text-sm font-medium text-slate-900">{def.label}</legend>
            {hintOf(def, state) !== undefined ? (
              <p className="text-sm text-slate-700">{hintOf(def, state)}</p>
            ) : null}
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {def.options.map((option) => (
                <CheckboxField
                  key={option.value}
                  label={option.label}
                  checked={selected.includes(option.value)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((value) => value !== option.value);
                    field.onChange(next.length > 0 ? next : null);
                  }}
                />
              ))}
            </div>
            {error !== undefined ? (
              <p className="text-sm font-medium text-red-800">{error}</p>
            ) : null}
          </fieldset>
        );
      }}
    />
  );
}

function RefInput({ def, name }: LeafProps<Extract<FieldDef, { kind: 'ref' }>>) {
  const error = useErrorMessage(name);
  const { control } = useFormContext();
  const { index } = useProfileData();
  const state = useStateOf(name);
  const disabled = state !== undefined && STATES_WITHOUT_VALUE.has(state);
  const options = def.refKinds.flatMap((kind) =>
    index.ofKind(kind).map((record) => ({
      value: record.id,
      label: describeRecord(kind, record.value, index).title,
    })),
  );
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const current = typeof field.value === 'string' ? field.value.toLowerCase() : '';
        return (
          <SelectField
            label={def.label}
            hint={hintOf(def, state)}
            error={error}
            options={options}
            disabled={disabled}
            value={options.some((option) => option.value === current) ? current : ''}
            onChange={(event) => {
              field.onChange(blankToNull(event.target.value));
            }}
            onBlur={field.onBlur}
            ref={field.ref}
          />
        );
      }}
    />
  );
}

export function FieldRenderer({ def, prefix = '' }: { def: FieldDef; prefix?: string }) {
  const name = prefix === '' ? def.name : `${prefix}.${def.name}`;
  switch (def.kind) {
    case 'text':
      return <TextInput def={def} name={name} />;
    case 'textarea':
      return <TextAreaInput def={def} name={name} />;
    case 'select':
      return <SelectInput def={def} name={name} />;
    case 'number':
      return <NumberInput def={def} name={name} />;
    case 'boolean':
      return <BooleanInput def={def} name={name} />;
    case 'date':
      return <DateInput def={def} name={name} />;
    case 'list':
      return <ListInput def={def} name={name} />;
    case 'multi':
      return <MultiInput def={def} name={name} />;
    case 'ref':
      return <RefInput def={def} name={name} />;
    case 'group':
      return (
        <fieldset className="flex flex-col gap-4 rounded-md border border-slate-300 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-900">{def.label}</legend>
          {def.hint !== undefined ? <p className="text-sm text-slate-700">{def.hint}</p> : null}
          {def.fields.map((child) => (
            <FieldRenderer key={child.name} def={child} prefix={name} />
          ))}
        </fieldset>
      );
  }
}
