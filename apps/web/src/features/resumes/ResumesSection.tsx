import type {
  CreateResumeResponse,
  ResumeSummary,
  ResumeVersionSummary,
} from '@chameleon/contracts';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { TextField } from '../../components/ui/TextField';
import { isApiError, messageForError } from '../../lib/api';
import { DownloadButtons } from './DownloadButtons';
import { VERSION_STATUS_LABELS, countsText, editorPath, formatDateTime } from './labels';
import {
  useCreateResume,
  useDeleteResume,
  useJobResumes,
  useNewVersion,
  useRenameResume,
} from './queries';

const linkClass =
  'inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';
const inlineLinkClass =
  'text-blue-800 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700';

function VersionRow({
  resume,
  version,
  busy,
  onNewVersion,
}: {
  resume: ResumeSummary;
  version: ResumeVersionSummary;
  busy: boolean;
  onNewVersion: (versionId: string) => void;
}) {
  const label = `versão ${String(version.versionNumber)}`;
  const approved = version.status === 'approved';
  return (
    <li className="flex flex-col gap-2 rounded-md border border-slate-300 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-slate-900">Versão {version.versionNumber}</span>
        <Badge tone={approved ? 'good' : 'warn'}>{VERSION_STATUS_LABELS[version.status]}</Badge>
        <span className="text-sm text-slate-700">
          Atualizada em {formatDateTime(version.updatedAt)}
        </span>
        <span className="text-sm text-slate-700">{countsText(version.issueCounts)}</span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Link to={editorPath(resume.id, version.id)} className={linkClass}>
          Abrir <span className="sr-only">{label}</span>
        </Link>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            onNewVersion(version.id);
          }}
        >
          Nova versão a partir desta <span className="sr-only">({label})</span>
        </Button>
        {approved ? (
          <DownloadButtons resumeId={resume.id} versionId={version.id} context={label} />
        ) : null}
      </div>
    </li>
  );
}

function ResumeCard({ resume }: { resume: ResumeSummary }) {
  const navigate = useNavigate();
  const nameId = useId();
  const rename = useRenameResume();
  const remove = useDeleteResume();
  const newVersion = useNewVersion();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(resume.name);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const busy = rename.isPending || remove.isPending || newVersion.isPending;

  const submitRename = (): void => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setNameError('Informe um nome para o currículo.');
      return;
    }
    setNameError(undefined);
    rename.mutate(
      { resumeId: resume.id, name: trimmed },
      {
        onSuccess: () => {
          setRenaming(false);
        },
      },
    );
  };

  return (
    <li className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-base font-semibold text-slate-900">{resume.name}</h3>
          <p className="text-sm text-slate-700">Atualizado em {formatDateTime(resume.updatedAt)}</p>
        </div>
        {renaming ? null : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setName(resume.name);
                setRenaming(true);
              }}
            >
              Renomear <span className="sr-only">{resume.name}</span>
            </Button>
            {confirming ? null : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Excluir… <span className="sr-only">{resume.name}</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {renaming ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <TextField
            label="Nome do currículo"
            value={name}
            maxLength={120}
            error={nameError}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          {rename.isError ? (
            <Alert tone="error" title="Não foi possível renomear">
              {messageForError(rename.error)}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? 'Salvando…' : 'Salvar nome'}
            </Button>
            <Button
              variant="secondary"
              disabled={rename.isPending}
              onClick={() => {
                setRenaming(false);
                setName(resume.name);
                setNameError(undefined);
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={`${nameId}-confirm`}
          className="flex flex-col gap-3 rounded-md border border-red-700 bg-red-50 p-4"
        >
          <p id={`${nameId}-confirm`} className="font-semibold text-red-900">
            Excluir este currículo e todas as suas versões?
          </p>
          <p className="text-sm text-red-900">
            O conteúdo editado e os arquivos que seriam gerados deixam de existir e não poderão ser
            recuperados. O seu perfil e a vaga não são alterados.
          </p>
          {remove.isError ? (
            <Alert tone="error" title="Não foi possível excluir">
              {messageForError(remove.error)}
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(resume.id);
              }}
            >
              {remove.isPending ? 'Excluindo…' : 'Excluir definitivamente'}
            </Button>
            <Button
              variant="secondary"
              disabled={remove.isPending}
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {newVersion.isError ? (
        <Alert tone="error" title="Não foi possível criar a nova versão">
          {messageForError(newVersion.error)}
        </Alert>
      ) : null}

      <ul aria-label={`Versões de ${resume.name}`} className="flex flex-col gap-2">
        {resume.versions.map((version) => (
          <VersionRow
            key={version.id}
            resume={resume}
            version={version}
            busy={busy}
            onNewVersion={(fromVersionId) => {
              newVersion.mutate(
                { resumeId: resume.id, fromVersionId },
                {
                  onSuccess: (response) => {
                    void navigate(editorPath(resume.id, response.version.id));
                  },
                },
              );
            }}
          />
        ))}
      </ul>
    </li>
  );
}

function Generated({ result }: { result: CreateResumeResponse }) {
  return (
    <Alert tone="info" title={`Currículo "${result.resume.name}" gerado`}>
      <p>
        A versão 1 é um rascunho montado só com itens confirmados do seu perfil. Revise antes de
        aprovar.{' '}
        <Link to={editorPath(result.resume.id, result.version.id)} className={inlineLinkClass}>
          Abrir a versão 1 no editor
        </Link>
      </p>
      {result.notes.length > 0 ? (
        <details className="mt-2">
          <summary className="w-fit cursor-pointer font-medium underline decoration-dotted">
            O que ficou de fora e por quê ({String(result.notes.length)})
          </summary>
          <ul className="mt-1 list-disc pl-5">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Alert>
  );
}

/** Curriculos gerados para esta vaga: gerar, abrir no editor, nova versao, baixar, renomear, excluir. */
export function ResumesSection({ jobId }: { jobId: string }) {
  const query = useJobResumes(jobId);
  const create = useCreateResume();

  return (
    <Section
      id="job-resumes"
      title="Currículos desta vaga"
      description="Montados só com itens confirmados do perfil. Só uma versão aprovada pode ser baixada."
      actions={
        <Button
          disabled={create.isPending}
          onClick={() => {
            create.mutate({ jobId });
          }}
        >
          {create.isPending ? 'Gerando…' : 'Gerar currículo'}
        </Button>
      }
    >
      {create.isError ? (
        <Alert tone="error" title="Não foi possível gerar o currículo">
          {messageForError(create.error)}
          {isApiError(create.error, 'PROFILE_REQUIRED') ? (
            <>
              {' '}
              <Link to="/perfil/importar" className="font-medium underline">
                Importar perfil
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}
      {create.isSuccess ? <Generated result={create.data} /> : null}

      {query.isPending ? <LoadingStatus label="Carregando os currículos…" /> : null}
      {query.isError ? (
        <Alert tone="error" title="Não foi possível carregar os currículos">
          {messageForError(query.error)}
        </Alert>
      ) : null}
      {query.isSuccess && query.data.resumes.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-400 bg-white p-4 text-sm">
          Nenhum currículo gerado para esta vaga ainda.
        </p>
      ) : null}
      {query.isSuccess && query.data.resumes.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {query.data.resumes.map((resume) => (
            <ResumeCard key={resume.id} resume={resume} />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
