import type { ReactNode } from 'react';
import { ChevronDownIcon } from './icons';
import { cx, focusRing, transition } from './styles';

/** The one collapsible block of the app (native details/summary: keyboard and screen readers for free). */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  variant = 'panel',
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** `panel` is a bordered block; `inline` is a text toggle inside other content. */
  variant?: 'panel' | 'inline';
}) {
  return (
    <details
      open={defaultOpen}
      className={cx(
        'group',
        variant === 'panel' ? 'rounded-panel border border-line bg-surface' : '',
      )}
    >
      <summary
        className={cx(
          'flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-control font-medium text-ink-2 hover:text-ink-1 [&::-webkit-details-marker]:hidden',
          variant === 'panel' ? 'w-full px-4 py-3 hover:bg-sunken/60' : 'py-1 text-meta',
          transition,
          focusRing,
        )}
      >
        <span className="transition-transform duration-150 group-open:rotate-180">
          <ChevronDownIcon />
        </span>
        {summary}
      </summary>
      <div className={variant === 'panel' ? 'border-t border-line px-4 py-3' : 'pt-2'}>
        {children}
      </div>
    </details>
  );
}
