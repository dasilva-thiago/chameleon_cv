import {
  DEFAULT_RESUME_EXPORT_TEMPLATE,
  RESUME_EXPORT_FORMATS,
  RESUME_EXPORT_TEMPLATES,
  resumeExportTemplateSchema,
  type ResumeExportTemplate,
} from '@chameleon/contracts';
import { useState } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField } from '../../components/ui/SelectField';
import { messageForError } from '../../lib/api';
import { EXPORT_FORMAT_LABELS, EXPORT_TEMPLATE_LABELS } from './labels';
import { useExportVersion } from './queries';

/**
 * Baixar PDF, DOCX ou HTML de uma versao APROVADA, no modelo escolhido (o arquivo e renderizado pelo servidor do conteudo
 * aprovado). `context` ("versao 2") desambigua os botoes para leitores de tela quando ha varios.
 */
export function DownloadButtons({
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
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label="Modelo do arquivo"
        placeholder={null}
        value={template}
        options={RESUME_EXPORT_TEMPLATES.map((value) => ({
          value,
          label: EXPORT_TEMPLATE_LABELS[value],
        }))}
        onChange={(event) => {
          const parsed = resumeExportTemplateSchema.safeParse(event.target.value);
          if (parsed.success) setTemplate(parsed.data);
        }}
      />
      <div className="flex flex-wrap gap-2">
        {RESUME_EXPORT_FORMATS.map((format) => (
          <Button
            key={format}
            variant="secondary"
            disabled={download.isPending}
            onClick={() => {
              download.mutate({ resumeId, versionId, format, template });
            }}
          >
            {download.isPending && download.variables.format === format ? (
              'Gerando…'
            ) : (
              <>
                Baixar {EXPORT_FORMAT_LABELS[format]} <span className="sr-only">({context})</span>
              </>
            )}
          </Button>
        ))}
      </div>
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
