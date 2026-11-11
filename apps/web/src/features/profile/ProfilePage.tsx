import { PROFILE_BASE_LIMITS, type BaseReading, type ProfileBase } from '@chameleon/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Section } from '../../components/layout/Section';
import { Alert } from '../../components/ui/Alert';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { AlertIcon, CheckCircleIcon, HistoryIcon } from '../../components/ui/icons';
import { Skeleton, SkeletonBlock } from '../../components/ui/Skeleton';
import { Spinner } from '../../components/ui/Spinner';
import { cx, panelClass } from '../../components/ui/styles';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { useToast } from '../../components/ui/Toast';
import { messageForError } from '../../lib/api';
import {
  useBaseReading,
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

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

type SaveMutation = ReturnType<typeof useSaveProfileBase>;

function Counter({ value, max }: { value: number; max: number }) {
  const near = value > max * 0.9;
  return (
    <span
      className={cx(
        'font-mono tabular-nums',
        value > max ? 'text-risk-text' : near ? 'text-attn-text' : '',
      )}
    >
      {value.toLocaleString('pt-BR')}/{max.toLocaleString('pt-BR')}
    </span>
  );
}

function ReadingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-overline font-semibold uppercase tracking-wider text-ink-3">{title}</h3>
      {children}
    </div>
  );
}

function ReadingView({ reading }: { reading: BaseReading }) {
  const { cv, profile } = reading;
  const untitled = cv.experiences.filter((experience) => experience.title === null).length;
  return (
    <div className="flex flex-col gap-5 text-body">
      {cv.experiences.length === 0 ? (
        <Alert tone="attention" title="Nenhuma experiência reconhecida">
          Use uma seção &quot;## Experiência&quot; com &quot;### Empresa — Cidade&quot;, o cargo em
          negrito e o período. As checagens comparam o cargo de cada empresa com o currículo.
        </Alert>
      ) : untitled > 0 ? (
        <Alert
          tone="attention"
          title={`${plural(untitled, 'experiência', 'experiências')} sem cargo`}
        >
          Coloque o cargo em negrito (&quot;**Cargo**&quot;) logo abaixo da empresa.
        </Alert>
      ) : null}

      <ReadingGroup title="Identificação">
        <p className="font-medium text-ink-1">{cv.name ?? 'Nome não encontrado'}</p>
        {cv.headline !== null ? <p className="text-ink-2">{cv.headline}</p> : null}
        <p className="text-meta text-ink-3">
          {[
            cv.location,
            plural(cv.contacts.email, 'e-mail', 'e-mails'),
            plural(cv.contacts.phone, 'telefone', 'telefones'),
            plural(cv.contacts.link, 'link', 'links'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </ReadingGroup>

      <ReadingGroup title={`Experiências (${String(cv.experiences.length)})`}>
        <ol className="flex flex-col divide-y divide-line rounded-control border border-line">
          {cv.experiences.map((experience, index) => (
            <li
              key={`${experience.company}-${String(index)}`}
              className="flex flex-col gap-0.5 px-3 py-2"
            >
              <p className="flex items-start justify-between gap-2">
                <span className="font-medium text-ink-1">{experience.company}</span>
                {experience.period !== null ? (
                  <span className="shrink-0 font-mono text-meta tabular-nums text-ink-3">
                    {experience.period}
                  </span>
                ) : null}
              </p>
              {experience.title !== null ? (
                <p className="flex items-center gap-1.5 text-meta text-ink-2">
                  <span className="text-evid">
                    <CheckCircleIcon />
                  </span>
                  Cargo: {experience.title} · {plural(experience.bullets, 'item', 'itens')}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-meta text-attn-text">
                  <AlertIcon /> Cargo não reconhecido
                </p>
              )}
            </li>
          ))}
        </ol>
      </ReadingGroup>

      {cv.projects.length > 0 ? (
        <ReadingGroup title={`Projetos (${String(cv.projects.length)})`}>
          <p className="text-ink-2">{cv.projects.map((project) => project.name).join(' · ')}</p>
        </ReadingGroup>
      ) : null}

      {cv.education.length > 0 ? (
        <ReadingGroup title={`Formação (${String(cv.education.length)})`}>
          <ul className="flex flex-col gap-0.5 text-ink-2">
            {cv.education.map((item, index) => (
              <li key={`${item.institution}-${String(index)}`}>
                {item.course !== null ? `${item.course} — ` : ''}
                {item.institution}
                {item.period !== null ? (
                  <span className="text-meta text-ink-3"> · {item.period}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </ReadingGroup>
      ) : null}

      {cv.skills.length > 0 ? (
        <ReadingGroup title="Habilidades">
          <ul className="flex flex-wrap gap-1.5">
            {cv.skills.map((group) => (
              <li key={group.group}>
                <Badge>
                  {group.group} <span className="font-mono">{group.items}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </ReadingGroup>
      ) : null}

      <ReadingGroup title="Perfil e regras">
        <p className="text-ink-2">
          Idioma dos currículos: <span className="font-mono">{profile.language}</span>
        </p>
        {profile.avoid.length > 0 ? (
          <>
            <p className="text-meta text-ink-3">
              Expressões a evitar ({profile.avoid.length}): um currículo que usar uma delas não pode
              ser aprovado.
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {profile.avoid.map((expression) => (
                <li key={expression}>
                  <Badge tone="bad">{expression}</Badge>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-meta text-ink-3">
            Nenhuma expressão a evitar (seção &quot;## Expressões a evitar&quot;).
          </p>
        )}
      </ReadingGroup>
    </div>
  );
}

/** Right column of the Base: what the checks will see, refreshed as you type. */
function ReadingPanel({ cv, profile }: { cv: string; profile: string }) {
  const reading = useBaseReading(cv, profile);
  const empty = cv.trim() === '' && profile.trim() === '';
  return (
    <section
      aria-labelledby="base-reading"
      className={cx(panelClass, 'flex flex-col gap-4 p-5 shadow-xs')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="base-reading" className="text-section font-semibold">
            Como o programa leu
          </h2>
          <p className="text-meta text-ink-3">
            É o que as checagens dos currículos usam. Atualiza enquanto você edita.
          </p>
        </div>
        {reading.isFetching ? <Spinner className="mt-1 text-brand" /> : null}
      </div>
      {empty ? (
        <p className="text-body text-ink-3">Escreva o CV ao lado para ver o que é reconhecido.</p>
      ) : reading.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : reading.isError ? (
        <p className="text-body text-ink-3">
          Não foi possível ler a base agora. Isso não impede salvar.
        </p>
      ) : (
        <div
          className={cx(
            reading.isPlaceholderData ? 'opacity-60' : '',
            'transition-opacity duration-150',
          )}
        >
          <ReadingView reading={reading.data.reading} />
        </div>
      )}
    </section>
  );
}

/**
 * Editor da base, montado de novo a cada revisao (o estado inicial vem da base salva). O salvamento vive no pai:
 * salvar cria uma revisao nova, o editor e remontado, e a confirmacao continua visivel.
 */
function BaseEditor({ base, save }: { base: ProfileBase | null; save: SaveMutation }) {
  const [cv, setCv] = useState(base?.cvMarkdown ?? '');
  const [profile, setProfile] = useState(base?.profileMarkdown ?? '');
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = cv !== (base?.cvMarkdown ?? '') || profile !== (base?.profileMarkdown ?? '');
  const tooLong =
    cv.length > PROFILE_BASE_LIMITS.cvChars || profile.length > PROFILE_BASE_LIMITS.profileChars;

  // Ctrl/Cmd+S saves; leaving with unsaved changes asks first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <form
        ref={formRef}
        className="flex min-w-0 flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dirty || tooLong || save.isPending) return;
          save.mutate({ cvMarkdown: cv, profileMarkdown: profile });
        }}
      >
        {base === null ? (
          <Alert tone="info" title="Comece pela sua base">
            Cole o seu CV em Markdown e o seu perfil (alvos, regras, salário). É com eles que cada
            vaga é avaliada e cada currículo é escrito.
          </Alert>
        ) : null}

        {/* Fixed action bar: counters, save (Ctrl/Cmd+S) and the last change. */}
        <div
          className={cx(
            panelClass,
            'sticky top-[3.75rem] z-20 flex flex-wrap items-center justify-between gap-3 px-4 py-3 shadow-md',
          )}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-ink-3">
            <span>
              CV <Counter value={cv.length} max={PROFILE_BASE_LIMITS.cvChars} />
            </span>
            <span>
              Perfil <Counter value={profile.length} max={PROFILE_BASE_LIMITS.profileChars} />
            </span>
            {base !== null ? (
              <span>Última alteração: {dateTime.format(new Date(base.updatedAt))}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            <span role="status" className="text-meta text-ink-3">
              {dirty ? 'Há alterações não salvas.' : ''}
            </span>
            <Button
              type="submit"
              disabled={!dirty || tooLong}
              loading={save.isPending}
              title="Ctrl+S"
            >
              {save.isPending ? 'Salvando…' : 'Salvar base'}
            </Button>
          </div>
        </div>

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

        <TextAreaField
          label="CV (Markdown)"
          hint="A única fonte de fatos: todo currículo gerado só pode afirmar o que está aqui."
          rows={26}
          className="min-h-[24rem] resize-y font-mono text-[0.8125rem] leading-relaxed"
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
          hint="Alvos, regras que barram vagas, faixas salariais e regras de escrita. Não acrescenta fatos sobre você."
          rows={18}
          className="min-h-[18rem] resize-y font-mono text-[0.8125rem] leading-relaxed"
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
      </form>
      <div className="xl:sticky xl:top-[3.75rem]">
        <ReadingPanel cv={cv} profile={profile} />
      </div>
    </div>
  );
}

function RevisionList({ currentId }: { currentId: string | null }) {
  const [open, setOpen] = useState(false);
  const revisions = useProfileRevisions(open);
  const restore = useRestoreRevision();
  const toast = useToast();

  return (
    <Section
      id="historico"
      title="Histórico"
      description="Cada versão salva da base fica guardada; os currículos apontam para a versão em que foram gerados."
      actions={
        <Button
          variant="secondary"
          icon={<HistoryIcon />}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
        >
          {open ? 'Ocultar versões' : 'Ver versões'}
        </Button>
      }
    >
      {!open ? null : revisions.isPending ? (
        <SkeletonBlock label="Carregando versões…" lines={3} />
      ) : revisions.isError ? (
        <Alert tone="error" title="Não foi possível carregar as versões">
          {messageForError(revisions.error)}
        </Alert>
      ) : (
        <ul className={cx(panelClass, 'flex flex-col divide-y divide-line')}>
          {revisions.data.revisions.map((revision) => (
            <li
              key={revision.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <span className="text-body text-ink-2">
                <span className="font-mono tabular-nums">
                  {dateTime.format(new Date(revision.createdAt))}
                </span>{' '}
                · CV {String(revision.cvChars)} · perfil {String(revision.profileChars)} caracteres
                {revision.id === currentId ? ' · atual' : ''}
              </span>
              {revision.id === currentId ? (
                <Badge tone="info">Atual</Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() => {
                    restore.mutate(revision.id, {
                      onSuccess: () => {
                        toast.show({
                          tone: 'success',
                          message: 'Versão restaurada como base atual.',
                        });
                      },
                    });
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
          <p>
            O que o sistema sabe sobre você. A IA lê esta base para avaliar vagas e escrever
            currículos, e o programa confere cada currículo contra ela.
          </p>
        }
      />
      {query.isPending ? (
        <SkeletonBlock label="Carregando a base…" lines={8} />
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
          <Disclosure summary="Formato esperado do CV e do perfil">
            <div className="flex flex-col gap-2 text-body text-ink-2">
              <p>{CV_HINT}</p>
              <p>{PROFILE_HINT}</p>
            </div>
          </Disclosure>
        </>
      )}
    </div>
  );
}
