import { Disclosure } from '../../components/ui/Disclosure';
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
import { MoreIcon } from '../../components/ui/icons';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { MenuButton, type MenuEntry } from '../../components/ui/MenuButton';
import { buttonClasses, linkClass } from '../../components/ui/styles';
import { TextField } from '../../components/ui/TextField';
import { isApiError, messageForError } from '../../lib/api';
import { DownloadMenu } from './DownloadMenu';
import { VERSION_STATUS_LABELS, editorPath, formatDateTime } from './labels';
import {
  useCreateResume,
  useDeleteResume,
  useJobResumes,
  useNewVersion,
  useRenameResume,
} from './queries';

const primaryLinkClass = buttonClasses('primary', 'sm');
const secondaryLinkClass = buttonClasses('secondary', 'sm');
const inlineLinkClass = linkClass;

const latestOf = (resume: ResumeSummary): ResumeVersionSummary =>
  resume.versions.reduce((best, version) =>
    version.versionNumber > best.versionNumber ? version : best,
  );

/** Situação da versão e, só quando existirem, os problemas que ela ainda tem. */
function VersionStatus({ version }: { version: ResumeVersionSummary }) {
  const { errors, warnings } = version.issueCounts;
  return (
    <>
      <Badge tone={version.status === 'approved' ? 'good' : 'warn'}>
        {VERSION_STATUS_LABELS[version.status]}
      </Badge>
      {errors > 0 ? (
        <Badge tone="bad">
          {String(errors)} {errors === 1 ? 'erro' : 'erros'}
        </Badge>
      ) : null}
      {warnings > 0 ? (
        <Badge tone="warn">
          {String(warnings)} {warnings === 1 ? 'aviso' : 'avisos'}
        </Badge>
      ) : null}
    </>
  );
}

/** Versões antigas: uma linha enxuta cada, com as ações num menu. */
function OlderVersionRow({
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
  const entries: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Nova versão a partir desta',
      disabled: busy,
      onSelect: () => {
        onNewVersion(version.id);
      },
    },
  ];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-1">Versão {version.versionNumber}</span>
        <VersionStatus version={version} />
        <span className="text-body text-ink-2">{formatDateTime(version.updatedAt)}</span>
      </div>
      <div className="flex items-start gap-2">
        <Link to={editorPath(resume.id, version.id)} className={secondaryLinkClass}>
          Abrir <span className="sr-only">{label}</span>
        </Link>
        {version.status === 'approved' ? (
          <DownloadMenu resumeId={resume.id} versionId={version.id} context={label} />
        ) : null}
        <MenuButton label={`Mais ações (${label})`} icon={<MoreIcon />} entries={entries} />
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
  const latest = latestOf(resume);
  const older = resume.versions.filter((version) => version.id !== latest.id);
  const latestLabel = `versão ${String(latest.versionNumber)}`;

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

  const createVersionFrom = (fromVersionId: string): void => {
    newVersion.mutate(
      { resumeId: resume.id, fromVersionId },
      {
        onSuccess: (response) => {
          void navigate(editorPath(resume.id, response.version.id));
        },
      },
    );
  };

  const moreEntries: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Renomear',
      disabled: busy,
      onSelect: () => {
        setName(resume.name);
        setRenaming(true);
      },
    },
    {
      kind: 'item',
      label: 'Nova versão a partir da última',
      disabled: busy,
      onSelect: () => {
        createVersionFrom(latest.id);
      },
    },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Excluir…',
      danger: true,
      disabled: busy,
      onSelect: () => {
        setConfirming(true);
      },
    },
  ];

  return (
    <li className="flex flex-col gap-3 rounded-control border border-line-strong bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-body font-semibold text-ink-1">{resume.name}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <VersionStatus version={latest} />
            <span className="text-body text-ink-2">
              Versão {latest.versionNumber} · {formatDateTime(latest.updatedAt)}
            </span>
          </div>
        </div>
        {renaming ? null : (
          <div className="flex items-start gap-2">
            <Link to={editorPath(resume.id, latest.id)} className={primaryLinkClass}>
              Abrir <span className="sr-only">{latestLabel}</span>
            </Link>
            {latest.status === 'approved' ? (
              <DownloadMenu resumeId={resume.id} versionId={latest.id} context={latestLabel} />
            ) : null}
            <MenuButton
              label={`Mais ações de ${resume.name}`}
              icon={<MoreIcon />}
              entries={moreEntries}
            />
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
          className="flex flex-col gap-3 rounded-control border border-risk bg-risk-soft p-4"
        >
          <p id={`${nameId}-confirm`} className="font-semibold text-risk-text">
            Excluir este currículo e todas as suas versões?
          </p>
          <p className="text-body text-risk-text">
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

      {older.length > 0 ? (
        <Disclosure summary={<>Versões anteriores ({String(older.length)})</>}>
          <ul
            aria-label={`Versões anteriores de ${resume.name}`}
            className="mt-1 flex flex-col divide-y divide-line"
          >
            {older.map((version) => (
              <OlderVersionRow
                key={version.id}
                resume={resume}
                version={version}
                busy={busy}
                onNewVersion={createVersionFrom}
              />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </li>
  );
}

function Generated({ result }: { result: CreateResumeResponse }) {
  return (
    <Alert tone="info" title={`Currículo "${result.resume.name}" gerado`}>
      <p>
        A versão 1 é um rascunho escrito pela IA a partir da sua base e conferido pelo programa.
        Revise antes de aprovar.{' '}
        <Link to={editorPath(result.resume.id, result.version.id)} className={inlineLinkClass}>
          Abrir a versão 1 no editor
        </Link>
      </p>
      {result.notes.length > 0 ? (
        <div className="mt-2">
          <Disclosure
            variant="inline"
            summary={<>O que ficou de fora e por quê ({String(result.notes.length)})</>}
          >
            <ul className="mt-1 list-disc pl-5">
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Disclosure>
        </div>
      ) : null}
    </Alert>
  );
}

/** Currículos gerados para esta vaga: abrir o mais recente, baixar, e o resto (renomear, versões, excluir) em menus. */
export function ResumesSection({ jobId }: { jobId: string }) {
  const query = useJobResumes(jobId);
  const create = useCreateResume();
  const hasResumes = query.isSuccess && query.data.resumes.length > 0;

  return (
    <Section
      id="job-resumes"
      title="Currículos desta vaga"
      description="Escritos pela IA a partir da sua base e da avaliação da vaga. Só uma versão aprovada pode ser baixada."
      actions={
        <Button
          variant={hasResumes ? 'secondary' : 'primary'}
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
              <Link to="/perfil" className="font-medium underline">
                Preencher a base
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
        <p className="rounded-control border border-dashed border-line-strong bg-surface p-4 text-body">
          Nenhum currículo gerado para esta vaga ainda.
        </p>
      ) : null}
      {hasResumes ? (
        <ul className="flex flex-col gap-3">
          {query.data.resumes.map((resume) => (
            <ResumeCard key={resume.id} resume={resume} />
          ))}
        </ul>
      ) : null}
    </Section>
  );
}
