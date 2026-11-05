import { Link } from 'react-router';
import { describeRecord, type ProfileIndex } from '../profile/document';
import { RECORD_KIND_LABELS } from '../profile/labels';
import { slugForKind } from '../profile/sections';

/**
 * Fontes de um item do curriculo: os registros do perfil que o sustentam, com link para a secao
 * do perfil. `index` e `null` enquanto o perfil nao carregou (ou se falhou).
 */
export function SourceList({
  sourceIds,
  index,
}: {
  sourceIds: readonly string[];
  index: ProfileIndex | null;
}) {
  if (sourceIds.length === 0) {
    return <p className="text-sm text-slate-700">Fontes: nenhuma.</p>;
  }
  if (index === null) {
    return <p className="text-sm text-slate-700">Fontes: carregando…</p>;
  }
  return (
    <div className="flex flex-wrap gap-x-2 text-sm text-slate-700">
      <span>Fontes:</span>
      <ul aria-label="Fontes" className="flex flex-wrap gap-x-3">
        {sourceIds.map((id) => {
          const record = index.byId.get(id.toLowerCase());
          if (record === undefined) {
            return <li key={id}>registro não encontrado</li>;
          }
          const text = `${RECORD_KIND_LABELS[record.kind]}: ${describeRecord(record.kind, record.value, index).title}`;
          const slug = slugForKind(record.kind);
          return (
            <li key={id}>
              {slug !== undefined ? (
                <Link
                  to={`/perfil/${slug}`}
                  className="text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  {text}
                </Link>
              ) : (
                text
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
