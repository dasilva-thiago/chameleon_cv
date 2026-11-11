import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx, errorTextClass, fieldClass, hintClass, labelClass } from './styles';

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
      <input
        id={id}
        ref={ref}
        required={required}
        aria-required={required === true ? true : undefined}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        className={cx(fieldClass(error !== undefined), 'h-9 pointer-coarse:h-11', className)}
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
