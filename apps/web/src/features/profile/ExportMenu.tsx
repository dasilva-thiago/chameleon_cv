import type { ExportQuery } from '@chameleon/contracts';
import { useMutation } from '@tanstack/react-query';
import { Alert } from '../../components/ui/Alert';
import { DownloadIcon } from '../../components/ui/icons';
import { MenuButton, type MenuEntry } from '../../components/ui/MenuButton';
import { messageForError, profileApi } from '../../lib/api';
import { saveBlob } from '../../lib/download';

type ExportFormat = NonNullable<ExportQuery['format']>;

const FORMAT_LABELS: Record<ExportFormat, string> = { yaml: 'YAML', json: 'JSON' };

/**
 * Exportar o perfil (backup): uma cópia completa, com campos privados e ids, que pode ser importada de volta sem
 * duplicar nada. O arquivo é só do dono: guardar em local seguro.
 */
export function ExportMenu({ disabled }: { disabled: boolean }) {
  const exportMutation = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const file = await profileApi.exportProfile(format);
      saveBlob(file.blob, file.filename ?? `chameleon-profile.${format}`);
      return format;
    },
  });

  const entries: MenuEntry[] = [
    { kind: 'heading', label: 'Backup do perfil' },
    ...(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((format): MenuEntry => ({
      kind: 'item',
      label: FORMAT_LABELS[format],
      onSelect: () => {
        exportMutation.mutate(format);
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <MenuButton
        label="Exportar perfil"
        text={exportMutation.isPending ? 'Gerando…' : 'Exportar'}
        icon={<DownloadIcon />}
        entries={entries}
        disabled={disabled || exportMutation.isPending}
      />
      {exportMutation.isError ? (
        <Alert tone="error" title="Não foi possível exportar">
          {messageForError(exportMutation.error)}
        </Alert>
      ) : null}
      <div role="status" aria-live="polite" className="max-w-56 text-sm text-slate-700">
        {exportMutation.isSuccess
          ? `Arquivo ${FORMAT_LABELS[exportMutation.data]} gerado, com campos privados: guarde em local seguro.`
          : ''}
      </div>
    </div>
  );
}
