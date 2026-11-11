import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { errorTextClass, hintClass } from './styles';

export interface CheckboxFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type'
> {
  label: ReactNode;
  /** Texto longo associado ao controle via aria-describedby. */
  description?: ReactNode;
  /** Mensagem de erro de validacao, ligada ao controle por aria-invalid e aria-describedby. */
  error?: string | undefined;
  ref?: Ref<HTMLInputElement>;
}

export function CheckboxField({ label, description, error, ref, ...rest }: CheckboxFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const describedBy =
    [description !== undefined ? descriptionId : null, error !== undefined ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        ref={ref}
        type="checkbox"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-5"
        {...rest}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="cursor-pointer text-body font-medium text-ink-1">
          {label}
        </label>
        {description !== undefined ? (
          <div id={descriptionId} className={hintClass}>
            {description}
          </div>
        ) : null}
        {error !== undefined ? (
          <p id={errorId} className={errorTextClass}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
