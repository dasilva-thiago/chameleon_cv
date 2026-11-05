import type { ExportQuery } from '@chameleon/contracts';
import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { messageForError, profileApi } from '../../lib/api';
import { saveBlob } from '../../lib/download';

type ExportFormat = NonNullable<ExportQuery['format']>;

const FORMAT_LABELS: Record<ExportFormat, string> = { yaml: 'YAML', json: 'JSON' };

/**
 * Exportacao do perfil (GET /export autenticado -> arquivo local). O arquivo e o proprio documento
 * do dono, com ids: pode ser importado de volta sem criar duplicatas.
 */
export function ExportCard({ disabled }: { disabled: boolean }) {
  const titleId = useId();
  const exportMutation = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const file = await profileApi.exportProfile(format);
      saveBlob(file.blob, file.filename ?? `chameleon-profile.${format}`);
      return format;
    },
  });

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Exportar seus dados
      </h2>
      <p className="text-sm text-slate-700">
        Baixe uma cópia completa do seu perfil, incluindo campos privados. O arquivo é só seu:
        guarde-o em local seguro.
      </p>
      {disabled ? (
        <p className="text-sm text-slate-800">
          A exportação fica disponível depois que o perfil tiver algum conteúdo.
        </p>
      ) : null}
      {exportMutation.isError ? (
        <Alert tone="error" title="Não foi possível exportar">
          {messageForError(exportMutation.error)}
        </Alert>
      ) : null}
      {exportMutation.isSuccess ? (
        <div role="status">
          <Alert tone="success">
            Arquivo {FORMAT_LABELS[exportMutation.data]} gerado. Verifique a pasta de downloads.
          </Alert>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((format) => (
          <Button
            key={format}
            variant="secondary"
            disabled={disabled || exportMutation.isPending}
            onClick={() => {
              exportMutation.mutate(format);
            }}
          >
            {exportMutation.isPending && exportMutation.variables === format
              ? 'Gerando…'
              : `Baixar ${FORMAT_LABELS[format]}`}
          </Button>
        ))}
      </div>
    </section>
  );
}
