import { cx } from './styles';

/** Placeholder with the shape of the content: nothing jumps when the data arrives. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx('block animate-shimmer rounded-control bg-sunken', className)}
    />
  );
}

/** A labelled loading region made of skeleton lines (the label is read by screen readers). */
export function SkeletonBlock({
  label,
  lines = 3,
  className = '',
}: {
  label: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} className={cx('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, n) => (
        <Skeleton key={n} className={cx('h-4', n === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}
