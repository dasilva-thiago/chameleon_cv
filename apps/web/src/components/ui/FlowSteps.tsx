import { CheckIcon } from './icons';
import { cx } from './styles';

export const FLOW = ['Base', 'Vaga', 'Avaliação', 'Currículo', 'Aprovado'] as const;

/** The flow line (Base → Vaga → Avaliação → Currículo → Aprovado): done steps checked, the current one in brand. */
export function FlowSteps({ current, className = '' }: { current: number; className?: string }) {
  return (
    <ol
      aria-label="Etapas do fluxo"
      className={cx('flex flex-wrap items-center gap-x-1.5 gap-y-2', className)}
    >
      {FLOW.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step}
            className="flex items-center gap-1.5"
            aria-current={active ? 'step' : undefined}
          >
            <span
              className={cx(
                'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-meta font-medium',
                done ? 'border-evid/30 bg-evid-soft text-evid-text' : '',
                active ? 'border-brand bg-brand-soft text-brand-text' : '',
                !done && !active ? 'border-line bg-surface text-ink-3' : '',
              )}
            >
              {done ? <CheckIcon /> : <span className="font-mono tabular-nums">{index + 1}</span>}
              {step}
              {done ? <span className="sr-only"> (feito)</span> : null}
            </span>
            {index < FLOW.length - 1 ? (
              <span
                aria-hidden="true"
                className={cx('h-px w-3', done ? 'bg-evid/50' : 'bg-line-strong/50')}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
