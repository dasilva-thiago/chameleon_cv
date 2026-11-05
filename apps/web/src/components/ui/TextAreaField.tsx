import { useId, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';

export interface TextAreaFieldProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'id'
> {
  label: string;
  hint?: ReactNode;
  error?: string | undefined;
  ref?: Ref<HTMLTextAreaElement>;
}

export function TextAreaField({
  label,
  hint,
  error,
  required,
  ref,
  rows = 3,
  className = '',
  ...rest
}: TextAreaFieldProps) {
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
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        required={required}
        aria-required={required === true ? true : undefined}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-md border px-3 py-2 text-base text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 ${
          error !== undefined ? 'border-red-700' : 'border-slate-500'
        } bg-white disabled:bg-slate-100 ${className}`}
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
