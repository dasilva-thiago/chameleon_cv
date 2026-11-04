export function LoadingStatus({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-6 text-slate-700">
      <span
        aria-hidden="true"
        className="size-5 animate-spin rounded-full border-2 border-slate-400 border-t-blue-700 motion-reduce:animate-none"
      />
      <span>{label}</span>
    </div>
  );
}
