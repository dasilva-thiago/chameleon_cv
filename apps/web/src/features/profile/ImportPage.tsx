import type {
  ApplyImportResponse,
  ImportPreviewRequest,
  ImportPreviewResponse,
} from '@chameleon/contracts';
import { useId, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { CheckboxField } from '../../components/ui/CheckboxField';
import { SelectField } from '../../components/ui/SelectField';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { isApiError, messageForError } from '../../lib/api';
import { RECORD_KIND_LABELS } from './labels';
import { useApplyImport, useDiscardImport, usePreviewImport } from './queries';

type Format = NonNullable<ImportPreviewRequest['format']>;
type ApplyMode = 'merge' | 'replace';

const FORMAT_OPTIONS: readonly { value: Format; label: string }[] = [
  { value: 'auto', label: 'Detectar automaticamente' },
  { value: 'yaml', label: 'YAML' },
  { value: 'json', label: 'JSON' },
];

const ACTION_LABELS = { create: 'Novo', update: 'Atualiza', unchanged: 'Sem mudança' } as const;
const ACTION_TONES = { create: 'good', update: 'info', unchanged: 'neutral' } as const;

/** Quantos registros a previa lista por extenso; o total sempre aparece nos contadores. */
const MAX_LISTED_RECORDS = 200;

type Stage =
  | { name: 'input' }
  | { name: 'preview'; data: ImportPreviewResponse }
  | { name: 'applied'; data: ApplyImportResponse }
  | { name: 'discarded' };

function Totals({ preview }: { preview: ImportPreviewResponse['preview'] }) {
  const items = [
    ['Novos', preview.totals.create],
    ['Atualizados', preview.totals.update],
    ['Sem mudança', preview.totals.unchanged],
    ['Para revisar', preview.totals.needs_review],
    ['Descartados', preview.totals.discarded],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-slate-400 bg-white p-3">
          <dt className="text-xs text-slate-700">{label}</dt>
          <dd className="text-xl font-semibold text-slate-900">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function InputStage({
  initialText,
  onPreview,
}: {
  initialText: string;
  onPreview: (data: ImportPreviewResponse, text: string) => void;
}) {
  const preview = usePreviewImport();
  const [text, setText] = useState(initialText);
  const [format, setFormat] = useState<Format>('auto');
  const [lenient, setLenient] = useState(false);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const fileId = useId();

  const readFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    setFileError(undefined);
    try {
      setText(await file.text());
      const name = file.name.toLowerCase();
      if (name.endsWith('.json')) setFormat('json');
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) setFormat('yaml');
    } catch {
      setFileError('Não foi possível ler o arquivo escolhido.');
    }
  };

  const submit = (): void => {
    preview.mutate(
      { format, text, mode: lenient ? 'lenient' : 'strict' },
      {
        onSuccess: (data) => {
          onPreview(data, text);
        },
      },
    );
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim() !== '') submit();
      }}
      className="flex flex-col gap-4 rounded-md border border-slate-400 bg-white p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-sm font-medium text-slate-900">
          Escolher um arquivo (.yaml, .yml ou .json)
        </label>
        <input
          id={fileId}
          type="file"
          accept=".yaml,.yml,.json,application/json,text/yaml,text/plain"
          onChange={(event) => {
            void readFile(event);
          }}
          className="text-sm"
        />
        {fileError !== undefined ? (
          <p className="text-sm font-medium text-red-800">{fileError}</p>
        ) : null}
      </div>
      <TextAreaField
        label="Ou cole o conteúdo aqui"
        hint="Nada é gravado nesta etapa: você verá uma prévia e decide se aplica."
        rows={12}
        spellCheck={false}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        className="font-mono"
      />
      <SelectField
        label="Formato"
        placeholder={null}
        options={FORMAT_OPTIONS}
        value={format}
        onChange={(event) => {
          setFormat(event.target.value as Format);
        }}
      />
      <CheckboxField
        label="Aceitar campos desconhecidos"
        description="Por padrão, campos que o perfil não conhece rejeitam o arquivo. Marque para importar o resto e listar o que foi ignorado."
        checked={lenient}
        onChange={(event) => {
          setLenient(event.target.checked);
        }}
      />
      {preview.isError ? (
        <Alert tone="error" title="Não foi possível gerar a prévia">
          {messageForError(preview.error)}
        </Alert>
      ) : null}
      <div>
        <Button type="submit" disabled={text.trim() === '' || preview.isPending}>
          {preview.isPending ? 'Gerando prévia…' : 'Gerar prévia'}
        </Button>
      </div>
    </form>
  );
}

function PreviewStage({
  data,
  onApplied,
  onDiscarded,
  onBack,
}: {
  data: ImportPreviewResponse;
  onApplied: (result: ApplyImportResponse) => void;
  onDiscarded: () => void;
  onBack: () => void;
}) {
  const apply = useApplyImport();
  const discard = useDiscardImport();
  const [mode, setMode] = useState<ApplyMode>('merge');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [regenerate, setRegenerate] = useState(false);
  const modeId = useId();
  const { preview, importRecord } = data;
  const blocking = importRecord.errors;
  const busy = apply.isPending || discard.isPending;
  const canApply =
    blocking.length === 0 &&
    !busy &&
    (mode === 'merge' || confirmReplace) &&
    preview.totals.records > 0;
  const listed = preview.records.slice(0, MAX_LISTED_RECORDS);

  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info" title="Prévia: nada foi gravado ainda">
        Revise o que será criado ou atualizado. A prévia expira em{' '}
        {new Date(data.expiresAt).toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })}
        .
      </Alert>

      <Totals preview={preview} />

      {blocking.length > 0 ? (
        <Alert tone="error" title="O arquivo tem erros e não pode ser aplicado">
          <ul className="list-disc pl-5">
            {blocking.map((error) => (
              <li key={`${error.path}-${error.code}`}>
                <code>{error.path === '' ? '(raiz)' : error.path}</code>: {error.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {data.warnings.length > 0 ? (
        <section aria-labelledby="import-warnings" className="flex flex-col gap-2">
          <h2 id="import-warnings" className="text-lg font-semibold">
            Avisos ({data.warnings.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {data.warnings.map((warning, position) => (
              <li
                key={`${warning.code}-${warning.path ?? ''}-${String(position)}`}
                className="flex flex-wrap items-start gap-2 rounded-md border border-slate-300 bg-white p-3 text-sm"
              >
                <Badge tone={warning.severity === 'warning' ? 'warn' : 'info'}>
                  {warning.severity === 'warning' ? 'Atenção' : 'Informação'}
                </Badge>
                <span>
                  {warning.message}
                  {warning.path !== null ? <code className="ml-1">({warning.path})</code> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.unmapped.length > 0 || preview.unmapped_count > 0 ? (
        <Alert tone="info" title="Campos ignorados">
          {String(preview.unmapped_count)} campo(s) do arquivo não existem no perfil e ficam de
          fora.
        </Alert>
      ) : null}

      {preview.records.length > 0 ? (
        <details className="rounded-md border border-slate-400 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-base font-medium">
            Ver os {String(preview.records.length)} registros do arquivo
          </summary>
          <ul className="flex flex-col gap-2 border-t border-slate-300 p-4">
            {listed.map((record) => (
              <li key={`${record.kind}-${record.id}`} className="flex flex-wrap gap-2 text-sm">
                <Badge tone={ACTION_TONES[record.action]}>{ACTION_LABELS[record.action]}</Badge>
                <span>
                  {RECORD_KIND_LABELS[record.kind]} — {record.label}
                </span>
                {record.changed_fields.length > 0 ? (
                  <span className="text-slate-700">
                    (campos: {record.changed_fields.join(', ')})
                  </span>
                ) : null}
              </li>
            ))}
            {preview.records.length > listed.length ? (
              <li className="text-sm text-slate-700">
                … e mais {String(preview.records.length - listed.length)} registros.
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}

      <fieldset className="flex flex-col gap-3 rounded-md border border-slate-400 bg-white p-4">
        <legend className="px-1 text-base font-semibold">Como aplicar</legend>
        <div className="flex items-start gap-3">
          <input
            id={`${modeId}-merge`}
            type="radio"
            name={`${modeId}-mode`}
            checked={mode === 'merge'}
            onChange={() => {
              setMode('merge');
            }}
            className="mt-1 size-5"
          />
          <label htmlFor={`${modeId}-merge`} className="text-sm">
            <strong>Mesclar</strong> (recomendado): adiciona e atualiza; nunca remove nada do seu
            perfil atual
            {preview.untouched_existing > 0
              ? ` (${String(preview.untouched_existing)} item(ns) atuais não aparecem no arquivo e continuam)`
              : ''}
            .
          </label>
        </div>
        <div className="flex items-start gap-3">
          <input
            id={`${modeId}-replace`}
            type="radio"
            name={`${modeId}-mode`}
            checked={mode === 'replace'}
            onChange={() => {
              setMode('replace');
            }}
            className="mt-1 size-5"
          />
          <label htmlFor={`${modeId}-replace`} className="text-sm">
            <strong>Substituir</strong>: o que não estiver no arquivo é arquivado (fatos) ou
            removido (contatos, evidências, pendências e restrições). Uma revisão do estado atual é
            guardada antes.
          </label>
        </div>
        {mode === 'replace' ? (
          <CheckboxField
            label="Entendo que a substituição remove itens que não estão no arquivo"
            checked={confirmReplace}
            onChange={(event) => {
              setConfirmReplace(event.target.checked);
            }}
          />
        ) : null}
        <CheckboxField
          label="Gerar novos identificadores se houver conflito"
          description="Use só se o arquivo veio de outra conta e a aplicação foi recusada por conflito de ids."
          checked={regenerate}
          onChange={(event) => {
            setRegenerate(event.target.checked);
          }}
        />
        <p className="text-sm text-slate-700">
          Tudo que for importado fica <strong>aguardando confirmação</strong> até você revisar.
        </p>
      </fieldset>

      {apply.isError ? (
        <Alert tone="error" title="Não foi possível aplicar">
          {isApiError(apply.error, 'TIMEOUT') || isApiError(apply.error, 'NETWORK')
            ? 'Perdemos a resposta do servidor. A importação pode ter sido concluída: confira o seu perfil antes de tentar de novo.'
            : messageForError(apply.error)}
        </Alert>
      ) : null}
      {discard.isError ? (
        <Alert tone="error" title="Não foi possível descartar">
          {messageForError(discard.error)}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!canApply}
          onClick={() => {
            apply.mutate(
              {
                importId: importRecord.id,
                input: {
                  mode,
                  confirmReplace: mode === 'replace' && confirmReplace,
                  regenerateConflictingIds: regenerate,
                },
              },
              { onSuccess: onApplied },
            );
          }}
        >
          {apply.isPending ? 'Aplicando…' : 'Aplicar importação'}
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            discard.mutate(importRecord.id, { onSuccess: onDiscarded });
          }}
        >
          {discard.isPending ? 'Descartando…' : 'Descartar prévia'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onBack}>
          Voltar e editar o texto
        </Button>
      </div>
    </div>
  );
}

/**
 * Importacao em tres passos: texto/arquivo -> previa (nada gravado) -> aplicar ou descartar.
 * Nunca sobrescreve em silencio: `replace` exige confirmacao e o resultado fica para revisao.
 */
export function ImportPage() {
  usePageTitle('Importar arquivo');
  const [stage, setStage] = useState<Stage>({ name: 'input' });
  const [text, setText] = useState('');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <PageHeading>Importar arquivo</PageHeading>
        <p className="text-base text-slate-800">
          Traga um perfil em YAML ou JSON (por exemplo, um backup exportado daqui). O conteúdo do
          arquivo é tratado como dado, nunca como instrução.
        </p>
      </div>

      {stage.name === 'input' ? (
        <InputStage
          initialText={text}
          onPreview={(data, sent) => {
            setText(sent);
            setStage({ name: 'preview', data });
          }}
        />
      ) : null}

      {stage.name === 'preview' ? (
        <PreviewStage
          data={stage.data}
          onApplied={(data) => {
            setText('');
            setStage({ name: 'applied', data });
          }}
          onDiscarded={() => {
            setText('');
            setStage({ name: 'discarded' });
          }}
          onBack={() => {
            setStage({ name: 'input' });
          }}
        />
      ) : null}

      {stage.name === 'applied' ? (
        <div className="flex flex-col gap-3" role="status">
          <Alert tone="success" title="Importação aplicada">
            {String(stage.data.save.summary.totals.created)} criado(s),{' '}
            {String(stage.data.save.summary.totals.updated)} atualizado(s). Uma revisão anterior foi
            guardada para você poder voltar.
          </Alert>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/perfil/confirmar"
              className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Revisar itens importados
            </Link>
            <Link
              to="/perfil"
              className="inline-flex min-h-11 items-center rounded-md border border-slate-400 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              Voltar à visão geral
            </Link>
          </div>
        </div>
      ) : null}

      {stage.name === 'discarded' ? (
        <div className="flex flex-col items-start gap-3" role="status">
          <Alert tone="info">Prévia descartada. Nada foi alterado no seu perfil.</Alert>
          <Button
            variant="secondary"
            onClick={() => {
              setStage({ name: 'input' });
            }}
          >
            Importar outro arquivo
          </Button>
        </div>
      ) : null}
    </div>
  );
}
