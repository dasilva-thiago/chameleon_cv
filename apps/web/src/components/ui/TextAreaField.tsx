import { useId, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react';
import { cx, errorTextClass, fieldClass, hintClass, labelClass } from './styles';

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
      <label htmlFor={id} className={labelClass}>
        {label}
        {required === true ? (
          <span aria-hidden="true" className="text-risk-text">
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
        className={cx(fieldClass(error !== undefined), 'py-2', className)}
        {...rest}
      />
      {hint !== undefined ? (
        <div id={hintId} className={hintClass}>
          {hint}
        </div>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} className={errorTextClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
