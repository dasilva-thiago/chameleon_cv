import { isFactKind, type RecordKind } from '@chameleon/contracts';
import { createElement, useId, useState, type ReactNode } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { isApiError, messageForError } from '../../lib/api';
import { useProfileData } from './context';
import {
  describeRecord,
  resumeUseOf,
  statusOf,
  visibilityOf,
  type Json,
  type ProfileIndex,
} from './document';
import { GovernanceEditor } from './GovernanceEditor';
import { RECORD_KIND_LABELS, RESUME_USE_LABELS, STATUS_LABELS, VISIBILITY_LABELS } from './labels';
import { useArchiveRecord, useDeleteRecord } from './queries';

const STATUS_TONE = {
  confirmed: 'good',
  needs_review: 'warn',
  conflicting: 'bad',
  archived: 'neutral',
} as const;

export function Heading({
  level,
  className,
  id,
  children,
}: {
  level: 2 | 3 | 4 | 5;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return createElement(`h${String(level)}`, { className, id }, children);
}

/** Selos de status, visibilidade e uso: sempre em texto. */
export function GovernanceBadges({ kind, record }: { kind: RecordKind; record: Json }) {
  if (kind === 'contact_point') {
    const visibility = record.visibility;
    return typeof visibility === 'string' && visibility in VISIBILITY_LABELS ? (
      <div className="flex flex-wrap gap-2">
        <Badge prefix="Visibilidade">
          {VISIBILITY_LABELS[visibility as keyof typeof VISIBILITY_LABELS]}
        </Badge>
      </div>
    ) : null;
  }
  if (!isFactKind(kind)) return null;
  const status = statusOf(record);
  const visibility = visibilityOf(record);
  const resumeUse = resumeUseOf(record);
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone={STATUS_TONE[status]} prefix="Situação">
        {STATUS_LABELS[status]}
      </Badge>
      {visibility !== undefined ? (
        <Badge prefix="Visibilidade">{VISIBILITY_LABELS[visibility]}</Badge>
      ) : null}
      {resumeUse !== undefined ? (
        <Badge prefix="Currículo">{RESUME_USE_LABELS[resumeUse]}</Badge>
      ) : null}
    </div>
  );
}

/** Registros que ainda dependem do que sera excluido (RECORD_IN_USE), resolvidos pelo indice local. */
function blockersOf(error: unknown, index: ProfileIndex): string[] {
  if (!isApiError(error, 'RECORD_IN_USE')) return [];
  const labels = new Set<string>();
  for (const detail of error.details) {
    const found = index.byId.get(detail.path.toLowerCase());
    if (found) {
      const { title } = describeRecord(found.kind, found.value, index);
      labels.add(`${RECORD_KIND_LABELS[found.kind]}: ${title}`);
    } else if (detail.path in RECORD_KIND_LABELS) {
      labels.add(RECORD_KIND_LABELS[detail.path as RecordKind]);
    } else {
      labels.add('Outro item do perfil');
    }
  }
  return [...labels];
}

export interface RecordCardProps {
  kind: RecordKind;
  id: string;
  record: Json;
  level: 2 | 3 | 4 | 5;
  onEdit: () => void;
  /** Conteudo extra recolhido (itens filhos, usos de competencia...). */
  extras?: { summary: string; content: ReactNode } | undefined;
  /** Dica exibida na confirmacao de exclusao. */
  deleteHint?: string | undefined;
  /** Substituem o titulo e o subtitulo calculados (usos de competencia mostram o contexto). */
  titleOverride?: string | undefined;
  subtitleOverride?: string | undefined;
}

export function RecordCard({
  kind,
  id,
  record,
  level,
  onEdit,
  extras,
  deleteHint,
  titleOverride,
  subtitleOverride,
}: RecordCardProps) {
  const { index } = useProfileData();
  const described = describeRecord(kind, record, index);
  const title = titleOverride ?? described.title;
  const subtitle = subtitleOverride ?? described.subtitle;
  const fact = isFactKind(kind);
  const status = fact ? statusOf(record) : undefined;
  const titleId = useId();
  const [panel, setPanel] = useState<'governance' | 'delete' | null>(null);
  const archive = useArchiveRecord();
  const remove = useDeleteRecord();
  const blockers = blockersOf(remove.error, index);
  const noun = RECORD_KIND_LABELS[kind].toLowerCase();

  return (
    <article
      aria-labelledby={titleId}
      className={`flex flex-col gap-3 rounded-md border bg-white p-4 ${
        status === 'archived' ? 'border-slate-300 opacity-90' : 'border-slate-400'
      }`}
    >
      <div className="flex flex-col gap-1">
        <Heading level={level} id={titleId} className="text-base font-semibold text-slate-900">
          {title}
        </Heading>
        {subtitle !== undefined ? <p className="text-sm text-slate-700">{subtitle}</p> : null}
      </div>
      <GovernanceBadges kind={kind} record={record} />

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" aria-label={`Editar ${title}`} onClick={onEdit}>
          Editar
        </Button>
        {fact ? (
          <Button
            variant="secondary"
            aria-label={`Situação e uso de ${title}`}
            aria-expanded={panel === 'governance'}
            onClick={() => {
              setPanel(panel === 'governance' ? null : 'governance');
            }}
          >
            Situação e uso
          </Button>
        ) : null}
        {fact && status !== 'archived' ? (
          <Button
            variant="secondary"
            aria-label={`Arquivar ${title}`}
            disabled={archive.isPending}
            onClick={() => {
              archive.mutate(id);
            }}
          >
            {archive.isPending ? 'Arquivando…' : 'Arquivar'}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          aria-label={`Excluir ${title}`}
          aria-expanded={panel === 'delete'}
          onClick={() => {
            remove.reset();
            setPanel(panel === 'delete' ? null : 'delete');
          }}
        >
          Excluir
        </Button>
      </div>

      {archive.isError ? (
        <Alert tone="error" title="Não foi possível arquivar">
          {messageForError(archive.error)}
        </Alert>
      ) : null}

      {panel === 'governance' ? <GovernanceEditor recordId={id} record={record} /> : null}

      {panel === 'delete' ? (
        <div
          role="group"
          aria-label={`Confirmar exclusão de ${title}`}
          className="flex flex-col gap-3 rounded-md border border-red-300 bg-red-50 p-4"
        >
          <p className="text-sm font-semibold text-red-900">Excluir {noun} definitivamente?</p>
          <p className="text-sm text-red-900">
            A exclusão não pode ser desfeita.{' '}
            {fact
              ? 'Se quiser apenas tirar este item de uso, use "Arquivar", que o mantém guardado.'
              : null}{' '}
            {deleteHint}
          </p>
          {remove.isError ? (
            <Alert tone="error" title="Não foi possível excluir">
              {messageForError(remove.error)}
              {blockers.length > 0 ? (
                <>
                  <span className="mt-2 block font-medium">Ainda dependem deste item:</span>
                  <ul className="list-disc pl-5">
                    {blockers.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                </>
              ) : null}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(id);
              }}
            >
              {remove.isPending ? 'Excluindo…' : 'Confirmar exclusão'}
            </Button>
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => {
                setPanel(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {extras !== undefined ? (
        <details className="rounded-md border border-slate-300">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-700">
            {extras.summary}
          </summary>
          <div className="border-t border-slate-300 p-3">{extras.content}</div>
        </details>
      ) : null}
    </article>
  );
}
