import type { ReactNode } from 'react';

type Tone = 'error' | 'info' | 'success';

const TONES: Record<Tone, string> = {
  error: 'border-red-700 bg-red-50 text-red-900',
  info: 'border-blue-700 bg-blue-50 text-blue-900',
  success: 'border-green-800 bg-green-50 text-green-900',
};

export interface AlertProps {
  tone: Tone;
  children: ReactNode;
  /** Titulo curto (negrito). Evita depender apenas da cor para transmitir o tipo. */
  title?: string;
}

/** Erros usam role="alert" (anunciado de imediato); demais avisos usam role="status". */
export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-md border-l-4 px-4 py-3 text-sm ${TONES[tone]}`}
    >
      {title !== undefined ? <p className="font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
