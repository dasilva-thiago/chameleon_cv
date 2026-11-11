import { PROFILE_BASE_LIMITS, type ProfileBase } from '@chameleon/contracts';
import { useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { messageForError } from '../../lib/api';
import {
  useProfileBase,
  useProfileRevisions,
  useRestoreRevision,
  useSaveProfileBase,
} from './queries';

const CV_HINT =
  'Seu currículo completo em Markdown: a única fonte de fatos. Todo currículo gerado só pode afirmar o que está aqui. Formato: "# CV -- Nome", linhas "**Email:** …", seções "## Experiência" com "### Empresa — Cidade", "**Cargo**", período e itens "- …".';

const PROFILE_HINT =
  'Alvos, regras que barram uma vaga (ex.: "Vagas que exigem Java estão fora do alvo"), faixas salariais por modalidade, política de local, como se apresentar por tipo de vaga e regras de escrita. Use uma seção "## Expressões a evitar" com uma expressão por item. Não acrescenta fatos sobre você.';

const dateTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type SaveMutation = ReturnType<typeof useSaveProfileBase>;

/**
 * Editor da base, montado de novo a cada revisao (o estado inicial vem da base salva). O salvamento vive no pai:
 * salvar cria uma revisao nova, o editor e remontado, e a confirmacao continua visivel.
 */
function BaseEditor({ base, save }: { base: ProfileBase | null; save: SaveMutation }) {
  const [cv, setCv] = useState(base?.cvMarkdown ?? '');
  const [profile, setProfile] = useState(base?.profileMarkdown ?? '');
  const dirty = cv !== (base?.cvMarkdown ?? '') || profile !== (base?.profileMarkdown ?? '');
  const tooLong =
    cv.length > PROFILE_BASE_LIMITS.cvChars || profile.length > PROFILE_BASE_LIMITS.profileChars;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ cvMarkdown: cv, profileMarkdown: profile });
      }}
    >
      {base === null ? (
        <Alert tone="info" title="Comece pela sua base">
          Cole o seu CV em Markdown e o seu perfil (alvos, regras, salário). É com eles que cada
          vaga é avaliada e cada currículo é escrito.
        </Alert>
      ) : null}
      <TextAreaField
        label="CV (Markdown)"
        hint={`${CV_HINT} ${String(cv.length)}/${String(PROFILE_BASE_LIMITS.cvChars)} caracteres.`}
        rows={24}
        className="font-mono text-sm"
        value={cv}
        spellCheck={false}
        onChange={(event) => {
          setCv(event.target.value);
        }}
        error={
          cv.length > PROFILE_BASE_LIMITS.cvChars
            ? 'O CV passou do limite de caracteres.'
            : undefined
        }
      />
      <TextAreaField
        label="Perfil e regras (Markdown)"
        hint={`${PROFILE_HINT} ${String(profile.length)}/${String(PROFILE_BASE_LIMITS.profileChars)} caracteres.`}
        rows={20}
        className="font-mono text-sm"
        value={profile}
        spellCheck={false}
        onChange={(event) => {
          setProfile(event.target.value);
        }}
        error={
          profile.length > PROFILE_BASE_LIMITS.profileChars
            ? 'O perfil passou do limite de caracteres.'
            : undefined
        }
      />
      {save.isError ? (
        <Alert tone="error" title="Não foi possível salvar">
          {messageForError(save.error)}
        </Alert>
      ) : null}
      {save.isSuccess && !dirty ? (
        <Alert tone="success" title={save.data.changed ? 'Base salva' : 'Nada mudou'}>
          {save.data.changed
            ? 'Uma nova versão foi guardada. Avaliações feitas com a base anterior aparecem como desatualizadas.'
            : 'O conteúdo é igual ao da versão atual.'}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={!dirty || tooLong || save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar base'}
        </Button>
        {base !== null ? (
          <span className="text-sm text-slate-700">
            Última alteração: {dateTime.format(new Date(base.updatedAt))}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function RevisionList({ currentId }: { currentId: string | null }) {
  const [open, setOpen] = useState(false);
  const revisions = useProfileRevisions(open);
  const restore = useRestoreRevision();

  return (
    <Section
      id="historico"
      title="Histórico"
      description="Cada versão salva da base fica guardada; os currículos apontam para a versão em que foram gerados."
      actions={
        <Button
          variant="secondary"
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? 'Ocultar versões' : 'Ver versões'}
        </Button>
      }
    >
      {!open ? null : revisions.isPending ? (
        <LoadingStatus label="Carregando versões…" />
      ) : revisions.isError ? (
        <Alert tone="error" title="Não foi possível carregar as versões">
          {messageForError(revisions.error)}
        </Alert>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200">
          {revisions.data.revisions.map((revision) => (
            <li
              key={revision.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
            >
              <span className="text-sm text-slate-800">
                {dateTime.format(new Date(revision.createdAt))} · CV {String(revision.cvChars)} ·
                perfil {String(revision.profileChars)} caracteres
                {revision.id === currentId ? ' · atual' : ''}
              </span>
              {revision.id === currentId ? null : (
                <Button
                  variant="secondary"
                  disabled={restore.isPending}
                  onClick={() => {
                    restore.mutate(revision.id);
                  }}
                >
                  Restaurar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {restore.isError ? (
        <Alert tone="error" title="Não foi possível restaurar">
          {messageForError(restore.error)}
        </Alert>
      ) : null}
    </Section>
  );
}

/** A base profissional (como o cv.md + _profile.md do career-ops), editada como texto. */
export function ProfilePage() {
  const query = useProfileBase();
  const save = useSaveProfileBase();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Base profissional"
        meta={
          <p className="text-sm text-slate-700">
            O que o sistema sabe sobre você. A IA lê esta base para avaliar vagas e escrever
            currículos, e o programa confere cada currículo contra ela.
          </p>
        }
      />
      {query.isPending ? (
        <LoadingStatus label="Carregando a base…" />
      ) : query.isError ? (
        <Alert tone="error" title="Não foi possível carregar a base">
          {messageForError(query.error)}
        </Alert>
      ) : (
        <>
          <BaseEditor
            key={query.data.base?.revisionId ?? 'new'}
            base={query.data.base}
            save={save}
          />
          {query.data.base !== null ? (
            <RevisionList currentId={query.data.base.revisionId} />
          ) : null}
        </>
      )}
    </div>
  );
}
