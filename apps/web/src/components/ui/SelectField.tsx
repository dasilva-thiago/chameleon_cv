import { useId, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  options: readonly { value: string; label: string }[];
  /** Texto da opcao vazia (valor ""); `null` remove a opcao. */
  placeholder?: string | null;
  hint?: ReactNode;
  error?: string | undefined;
  ref?: Ref<HTMLSelectElement>;
}

export function SelectField({
  label,
  options,
  placeholder = 'Não informado',
  hint,
  error,
  required,
  ref,
  className = '',
  ...rest
}: SelectFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-900">
        {label}
        {required === true ? (
          <span aria-hidden="true" className="text-red-700">
            {' '}
            *
          </span>
        ) : null}
      </label>
      <select
        id={id}
        ref={ref}
        required={required}
        aria-required={required === true ? true : undefined}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-11 w-full rounded-md border bg-white px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 disabled:bg-slate-100 ${
          error !== undefined ? 'border-red-700' : 'border-slate-500'
        } ${className}`}
        {...rest}
      >
        {placeholder !== null ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined ? (
        <div id={hintId} className="text-sm text-slate-700">
          {hint}
        </div>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} className="text-sm font-medium text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}
