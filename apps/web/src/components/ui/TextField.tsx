import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  /** Texto de apoio associado ao campo via aria-describedby. */
  hint?: ReactNode;
  error?: string | undefined;
  /** Ref do elemento (React 19 aceita `ref` como prop). */
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  hint,
  error,
  required,
  ref,
  className = '',
  ...rest
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint !== undefined ? hintId : null, error !== undefined ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;
  const readOnly = rest.readOnly === true;

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
      <input
        id={id}
        ref={ref}
        required={required}
        aria-required={required === true ? true : undefined}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-11 w-full rounded-md border px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 ${
          error !== undefined ? 'border-red-700' : 'border-slate-500'
        } ${readOnly ? 'bg-slate-100' : 'bg-white'} ${className}`}
        {...rest}
      />
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
