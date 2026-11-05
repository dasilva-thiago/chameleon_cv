import { RESUME_EXPORT_FORMATS } from '@chameleon/contracts';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { messageForError } from '../../lib/api';
import { EXPORT_FORMAT_LABELS } from './labels';
import { useExportVersion } from './queries';

/**
 * Baixar DOCX/PDF de uma versao APROVADA (o arquivo e renderizado pelo servidor do conteudo
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
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {RESUME_EXPORT_FORMATS.map((format) => (
          <Button
            key={format}
            variant="secondary"
            disabled={download.isPending}
            onClick={() => {
              download.mutate({ resumeId, versionId, format });
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
