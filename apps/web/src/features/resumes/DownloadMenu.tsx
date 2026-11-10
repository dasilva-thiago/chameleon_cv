import {
  DEFAULT_RESUME_EXPORT_TEMPLATE,
  RESUME_EXPORT_FORMATS,
  RESUME_EXPORT_TEMPLATES,
  type ResumeExportTemplate,
} from '@chameleon/contracts';
import { useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { DownloadIcon } from '../../components/ui/icons';
import { MenuButton, type MenuEntry } from '../../components/ui/MenuButton';
import { messageForError } from '../../lib/api';
import { EXPORT_FORMAT_LABELS, EXPORT_TEMPLATE_LABELS } from './labels';
import { useExportVersion } from './queries';

/**
 * Menu "Baixar" de uma versão APROVADA: escolhe o modelo e o formato (PDF, DOCX ou HTML) num só lugar; o arquivo é
 * renderizado pelo servidor a partir do conteúdo aprovado. `context` ("versão 2") desambigua o botão para leitores de
 * tela quando há vários.
 */
export function DownloadMenu({
  resumeId,
  versionId,
  context,
}: {
  resumeId: string;
  versionId: string;
  context: string;
}) {
  const download = useExportVersion();
  const [template, setTemplate] = useState<ResumeExportTemplate>(DEFAULT_RESUME_EXPORT_TEMPLATE);

  const entries: MenuEntry[] = [
    { kind: 'heading', label: 'Modelo' },
    ...RESUME_EXPORT_TEMPLATES.map((value): MenuEntry => ({
      kind: 'radio',
      label: EXPORT_TEMPLATE_LABELS[value],
      checked: template === value,
      onSelect: () => {
        setTemplate(value);
      },
    })),
    { kind: 'separator' },
    { kind: 'heading', label: 'Formato' },
    ...RESUME_EXPORT_FORMATS.map((format): MenuEntry => ({
      kind: 'item',
      label: EXPORT_FORMAT_LABELS[format],
      onSelect: () => {
        download.mutate({ resumeId, versionId, format, template });
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <MenuButton
        label={`Baixar (${context})`}
        text={download.isPending ? 'Gerando…' : 'Baixar'}
        icon={<DownloadIcon />}
        entries={entries}
        disabled={download.isPending}
      />
      {download.isError ? (
        <Alert tone="error" title="Não foi possível baixar">
          {messageForError(download.error)}
        </Alert>
      ) : null}
      <div role="status" aria-live="polite" className="text-sm text-slate-700">
        {download.isSuccess
          ? `Arquivo ${EXPORT_FORMAT_LABELS[download.data]} gerado (${context}). Verifique a pasta de downloads.`
          : ''}
      </div>
    </div>
  );
}
