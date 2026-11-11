import { APP_NAME } from '../../lib/config';

/** Brand mark: the chameleon tail spiral (brand) with an evidence dot (green). Decorative; the name is in the text. */
export function MarkIcon({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <path
        d="M16 27c-6.1 0-11-4.9-11-11S9.9 5 16 5s11 4.9 11 11c0 4.4-3.6 8-8 8s-6-2.7-6-6 2.2-5 5-5 3.5 1.6 3.5 3.5"
        fill="none"
        stroke="var(--brand)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="19.5" cy="16.5" r="2.2" fill="var(--evid)" />
    </svg>
  );
}

/** Mark + wordmark ("Chameleon" + "CV" in mono). `compact` shows only the mark (collapsed sidebar). */
export function Mark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-ink-1">
      <MarkIcon />
      {compact ? (
        <span className="sr-only">{APP_NAME}</span>
      ) : (
        <span className="text-[1.0625rem] font-semibold tracking-tight">
          Chameleon<span className="ml-0.5 font-mono text-brand">CV</span>
        </span>
      )}
    </span>
  );
}
