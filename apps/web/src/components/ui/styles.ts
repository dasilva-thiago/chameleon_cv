/**
 * Shared class recipes of the design system (docs/design-system.md). Every interactive element gets the same focus ring,
 * transition and disabled treatment from here, so the states of plan §3.7 cannot drift between components.
 */

export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

/** 2px brand ring, 2px offset, only for keyboard focus. */
export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

/** Ring drawn inside the element (rows, menu items) so it is never clipped by an overflow parent. */
export const focusRingInset =
  'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand';

export const transition =
  'transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ease-out';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-brand text-on-brand shadow-xs hover:bg-brand-hover active:bg-brand-active',
  secondary: 'border-line-strong bg-surface text-ink-1 hover:bg-sunken active:bg-line',
  ghost:
    'border-transparent bg-transparent text-ink-2 hover:bg-sunken hover:text-ink-1 active:bg-line',
  danger:
    'border-transparent bg-risk text-on-risk shadow-xs hover:bg-risk-hover active:bg-risk-hover focus-visible:outline-risk',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-meta pointer-coarse:h-10',
  md: 'h-9 gap-2 px-3.5 text-body pointer-coarse:h-11',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return cx(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-control border font-medium',
    'cursor-pointer disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    transition,
    focusRing,
    VARIANTS[variant],
    SIZES[size],
  );
}

/** Text link inside prose (underlined) or in navigation (underline on hover). */
export const linkClass = cx(
  'rounded-sm font-medium text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand active:text-brand-active',
  transition,
  focusRing,
);

export const fieldClass = (invalid: boolean): string =>
  cx(
    'w-full rounded-control border bg-surface px-3 text-ink-1 placeholder:text-ink-3',
    'text-base sm:text-body',
    transition,
    'outline-none focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/25',
    'hover:border-ink-3 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 read-only:bg-sunken',
    invalid
      ? 'border-risk hover:border-risk focus-visible:border-risk focus-visible:ring-risk/25'
      : 'border-line-strong',
  );

export const labelClass = 'text-meta font-medium text-ink-1';
export const hintClass = 'text-meta text-ink-3';
export const errorTextClass = 'text-meta font-medium text-risk-text';

/** Surface of a panel/card. */
export const panelClass = 'rounded-panel border border-line bg-surface';
