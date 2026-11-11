import {
  RESUME_LIMITS,
  type ResumeBullet,
  type ResumeContent,
  type ResumeIssue,
} from '@chameleon/contracts';
import { useId } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { TextAreaField } from '../../components/ui/TextAreaField';
import { TextField } from '../../components/ui/TextField';
import {
  addBullet,
  displayOrigin,
  patchBulletText,
  patchEntry,
  patchHeader,
  patchSection,
  removeBullet,
  removeContact,
  removeEntry,
  removeSection,
} from './content';
import { CONTACT_KIND_LABELS, ORIGIN_LABELS } from './labels';

const ORIGIN_TONES = { generated: 'neutral', edited: 'info', added: 'warn' } as const;

interface FormContext {
  content: ResumeContent;
  /** Aplica a mudanca; `announce` e lido por leitores de tela quando algo some ou aparece. */
  change: (next: ResumeContent, announce?: string) => void;
  /** Erros de validacao local por caminho do campo (`sections.0.title`). */
  errors: ReadonlyMap<string, string>;
  /** Problemas do servidor por caminho do item (`sections.0.entries.1.bullets.2`). */
  issues: ReadonlyMap<string, ResumeIssue[]>;
  saved: ReadonlyMap<string, ResumeBullet>;
}

function IssueList({ issues }: { issues: readonly ResumeIssue[] | undefined }) {
  if (issues === undefined || issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-body">
      {issues.map((issue) => (
        <li
          key={`${issue.code}-${issue.message}`}
          className={issue.severity === 'error' ? 'text-risk-text' : 'text-attn-text'}
        >
          <span className="font-semibold">{issue.severity === 'error' ? 'Erro:' : 'Aviso:'}</span>{' '}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function BulletEditor({ ctx, s, e, b }: { ctx: FormContext; s: number; e: number; b: number }) {
  const bullet = ctx.content.sections[s]?.entries[e]?.bullets[b];
  if (bullet === undefined) return null;
  const path = `sections.${String(s)}.entries.${String(e)}.bullets.${String(b)}`;
  const origin = displayOrigin(bullet, ctx.saved);
  return (
    <li className="flex flex-col gap-2 rounded-control border border-line bg-sunken p-3">
      <TextAreaField
        label={`Item ${String(b + 1)}`}
        rows={2}
        value={bullet.text}
        error={ctx.errors.get(`${path}.text`)}
        onChange={(event) => {
          ctx.change(patchBulletText(ctx.content, s, e, b, event.target.value));
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={ORIGIN_TONES[origin]} prefix="Origem">
          {ORIGIN_LABELS[origin]}
        </Badge>
        <Button
          variant="secondary"
          onClick={() => {
            ctx.change(removeBullet(ctx.content, s, e, b), `Item ${String(b + 1)} removido.`);
          }}
        >
          Remover item <span className="sr-only">{String(b + 1)}</span>
        </Button>
      </div>
      <IssueList issues={ctx.issues.get(path)} />
    </li>
  );
}

function EntryEditor({ ctx, s, e }: { ctx: FormContext; s: number; e: number }) {
  const headingId = useId();
  const entry = ctx.content.sections[s]?.entries[e];
  if (entry === undefined) return null;
  const path = `sections.${String(s)}.entries.${String(e)}`;
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-control border border-line-strong bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={headingId} className="text-body font-semibold text-ink-1">
          {entry.heading.trim() === '' ? 'Entrada sem título' : entry.heading}
        </h3>
        <Button
          variant="secondary"
          onClick={() => {
            ctx.change(removeEntry(ctx.content, s, e), 'Entrada removida.');
          }}
        >
          Remover entrada
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label="Título da entrada"
          value={entry.heading}
          error={ctx.errors.get(`${path}.heading`)}
          onChange={(event) => {
            ctx.change(patchEntry(ctx.content, s, e, { heading: event.target.value }));
          }}
        />
        <TextField
          label="Subtítulo"
          value={entry.subheading ?? ''}
          error={ctx.errors.get(`${path}.subheading`)}
          onChange={(event) => {
            ctx.change(
              patchEntry(ctx.content, s, e, {
                subheading: event.target.value === '' ? null : event.target.value,
              }),
            );
          }}
        />
        <TextField
          label="Período"
          value={entry.period ?? ''}
          error={ctx.errors.get(`${path}.period`)}
          onChange={(event) => {
            ctx.change(
              patchEntry(ctx.content, s, e, {
                period: event.target.value === '' ? null : event.target.value,
              }),
            );
          }}
        />
      </div>
      <IssueList issues={ctx.issues.get(path)} />
      {entry.bullets.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {entry.bullets.map((bullet, b) => (
            <BulletEditor key={bullet.id} ctx={ctx} s={s} e={e} b={b} />
          ))}
        </ul>
      ) : (
        <p className="text-body text-ink-2">Esta entrada não tem itens.</p>
      )}
      <div>
        <Button
          variant="secondary"
          disabled={entry.bullets.length >= RESUME_LIMITS.bulletsPerEntry}
          onClick={() => {
            ctx.change(addBullet(ctx.content, s, e), 'Item adicionado ao final da entrada.');
          }}
        >
          Adicionar item
        </Button>
      </div>
    </div>
  );
}

function SectionEditor({ ctx, s }: { ctx: FormContext; s: number }) {
  const headingId = useId();
  const section = ctx.content.sections[s];
  if (section === undefined) return null;
  const path = `sections.${String(s)}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-section font-semibold">
          {section.title.trim() === '' ? 'Seção sem título' : section.title}
        </h2>
        <Button
          variant="secondary"
          onClick={() => {
            ctx.change(removeSection(ctx.content, s), 'Seção removida.');
          }}
        >
          Remover seção
        </Button>
      </div>
      <div className="max-w-md">
        <TextField
          label="Título da seção"
          value={section.title}
          error={ctx.errors.get(`${path}.title`)}
          onChange={(event) => {
            ctx.change(patchSection(ctx.content, s, { title: event.target.value }));
          }}
        />
      </div>
      <IssueList issues={ctx.issues.get(path)} />
      {section.entries.length === 0 ? (
        <p className="text-body text-ink-2">Esta seção não tem entradas.</p>
      ) : null}
      {section.entries.map((entry, e) => (
        <EntryEditor key={entry.id} ctx={ctx} s={s} e={e} />
      ))}
    </section>
  );
}

/** Formulario de edicao do rascunho: cabecalho, contatos e secoes com entradas e itens. */
export function ResumeForm(ctx: FormContext) {
  const { header } = ctx.content;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="resume-header" className="flex flex-col gap-3">
        <h2 id="resume-header" className="text-section font-semibold">
          Cabeçalho
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            label="Nome"
            required
            value={header.name}
            error={ctx.errors.get('header.name')}
            onChange={(event) => {
              ctx.change(patchHeader(ctx.content, { name: event.target.value }));
            }}
          />
          <TextField
            label="Título profissional"
            value={header.headline ?? ''}
            error={ctx.errors.get('header.headline')}
            onChange={(event) => {
              ctx.change(
                patchHeader(ctx.content, {
                  headline: event.target.value === '' ? null : event.target.value,
                }),
              );
            }}
          />
          <TextField
            label="Localização"
            value={header.location ?? ''}
            error={ctx.errors.get('header.location')}
            onChange={(event) => {
              ctx.change(
                patchHeader(ctx.content, {
                  location: event.target.value === '' ? null : event.target.value,
                }),
              );
            }}
          />
        </div>
        {header.contacts.length === 0 ? (
          <p className="text-body text-ink-2">Nenhum contato neste currículo.</p>
        ) : (
          <ul aria-label="Contatos" className="flex flex-col gap-2">
            {header.contacts.map((contact, n) => (
              <li
                key={`${contact.kind}-${contact.value}`}
                className="flex flex-col gap-2 rounded-control border border-line bg-sunken p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="break-all font-medium text-ink-1">
                    {CONTACT_KIND_LABELS[contact.kind]}: {contact.value}
                    {contact.label !== null ? ` (${contact.label})` : ''}
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      ctx.change(removeContact(ctx.content, n), 'Contato removido.');
                    }}
                  >
                    Remover contato <span className="sr-only">{contact.value}</span>
                  </Button>
                </div>
                <IssueList issues={ctx.issues.get(`header.contacts.${String(n)}`)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {ctx.content.sections.length === 0 ? (
        <p className="rounded-control border border-dashed border-line-strong bg-surface p-4 text-body">
          O currículo não tem nenhuma seção.
        </p>
      ) : null}
      {ctx.content.sections.map((section, s) => (
        <SectionEditor key={section.id} ctx={ctx} s={s} />
      ))}
    </div>
  );
}
