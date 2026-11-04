import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

export interface CheckboxFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'type'
> {
  label: ReactNode;
  /** Texto longo associado ao controle via aria-describedby. */
  description?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

export function CheckboxField({ label, description, ref, ...rest }: CheckboxFieldProps) {
  const id = useId();
  const descriptionId = `${id}-description`;
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        ref={ref}
        type="checkbox"
        aria-describedby={description !== undefined ? descriptionId : undefined}
        className="mt-1 size-5 shrink-0 accent-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        {...rest}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-base font-medium text-slate-900">
          {label}
        </label>
        {description !== undefined ? (
          <div id={descriptionId} className="text-sm text-slate-700">
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}
