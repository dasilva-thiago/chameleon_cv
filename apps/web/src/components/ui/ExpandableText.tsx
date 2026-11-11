import { useId, useState } from 'react';
import { linkClass } from './styles';

/** Texto de linhas e/ou caracteres a partir do qual vale recolher. */
const COLLAPSE_AFTER_LINES = 8;
const COLLAPSE_AFTER_CHARS = 700;

/**
 * Texto longo (por exemplo, a descrição de uma vaga) recolhido em poucas linhas, com um botão para ver tudo.
 * O texto completo continua no documento (só fica cortado na tela), então busca e leitores de tela o encontram.
 */
export function ExpandableText({
  text,
  expandLabel = 'Ver texto completo',
  collapseLabel = 'Mostrar menos',
}: {
  text: string;
  expandLabel?: string;
  collapseLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const long = text.length > COLLAPSE_AFTER_CHARS || text.split('\n').length > COLLAPSE_AFTER_LINES;
  const clipped = long && !expanded;

  return (
    <div className="flex flex-col gap-2">
      <pre
        id={textId}
        className={`whitespace-pre-wrap break-words rounded-panel border border-line bg-sunken p-4 font-sans text-body text-ink-1 ${clipped ? 'line-clamp-6' : ''}`}
      >
        {text}
      </pre>
      {long ? (
        <div>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => {
              setExpanded((value) => !value);
            }}
            className={`${linkClass} cursor-pointer px-0.5 py-1`}
          >
            {expanded ? collapseLabel : expandLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
