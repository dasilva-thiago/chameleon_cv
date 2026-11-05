import type { ReactNode } from 'react';

type BadgeTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-slate-500 bg-slate-100 text-slate-900',
  good: 'border-green-800 bg-green-50 text-green-900',
  warn: 'border-amber-800 bg-amber-50 text-amber-950',
  bad: 'border-red-800 bg-red-50 text-red-900',
  info: 'border-blue-800 bg-blue-50 text-blue-900',
};

/**
 * Selo informativo. O significado esta sempre no TEXTO (a cor apenas reforca), entao o selo
 * continua legivel sem distinguir cores. Prefixo opcional descreve a dimensao ("Status: ...").
 */
export function Badge({
  tone = 'neutral',
  prefix,
  children,
}: {
  tone?: BadgeTone;
  prefix?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {prefix !== undefined ? <span className="font-normal">{prefix}:</span> : null}
      {children}
    </span>
  );
}
