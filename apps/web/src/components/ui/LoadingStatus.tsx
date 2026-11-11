import { Spinner } from './Spinner';

export function LoadingStatus({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-ink-2">
      <Spinner className="text-brand" />
      <span>{label}</span>
    </div>
  );
}
