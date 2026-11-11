import { useId, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';
import { cx, errorTextClass, fieldClass, hintClass, labelClass } from './styles';

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
      <label htmlFor={id} className={labelClass}>
        {label}
        {required === true ? (
          <span aria-hidden="true" className="text-risk-text">
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
        className={cx(
          fieldClass(error !== undefined),
          'h-9 cursor-pointer pr-8 pointer-coarse:h-11',
          className,
        )}
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
