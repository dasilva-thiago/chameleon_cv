import {
  profileDocumentSchema,
  profileStateResponseSchema,
  resumeContentSchema,
  resumeResponseSchema,
  resumeSummarySchema,
  resumeVersionDetailSchema,
  resumeVersionResponseSchema,
  type ResumeContent,
  type ResumeIssue,
  type ResumeSummary,
  type ResumeVersionDetail,
} from '@chameleon/contracts';
import { jsonResponse, type FakeApi } from './fake-api';

const ID = (n: number): string => `0190a8f0-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const JOB_ID = ID(101);
export const RESUME_ID = ID(201);
export const V1 = ID(211);
export const V2 = ID(212);
export const V3 = ID(213);
export const CONTACT_ID = ID(301);
export const STATEMENT_ID = ID(302);
export const SKILL_TS_ID = ID(303);
export const SKILL_NODE_ID = ID(304);
export const EXPERIENCE_ID = ID(305);
export const EXP_ITEM_ID = ID(306);
export const MISSING_ID = ID(399);

export const NOW = '2026-11-05T12:00:00.000Z';

/** Conteudo limpo: todas as fontes existem no perfil de `profileState()`. */
export function makeContent(): ResumeContent {
  return resumeContentSchema.parse({
    schemaVersion: 1,
    language: 'pt-BR',
    header: {
      name: 'Ana Teste',
      headline: 'Desenvolvedora Backend',
      location: 'São Paulo, SP',
      contacts: [{ kind: 'email', value: 'ana@example.com', label: null, sourceId: CONTACT_ID }],
    },
    sections: [
      {
        id: 'summary',
        kind: 'summary',
        title: 'Resumo',
        entries: [
          {
            id: 'summary-1',
            heading: 'Resumo',
            subheading: null,
            period: null,
            sourceIds: [STATEMENT_ID],
            bullets: [
              {
                id: 'summary-1-b1',
                text: 'Desenvolvedora backend com foco em APIs.',
                sourceIds: [STATEMENT_ID],
                origin: 'generated',
              },
            ],
          },
        ],
      },
      {
        id: 'skills',
        kind: 'skills',
        title: 'Competências',
        entries: [
          {
            id: 'skills-1',
            heading: 'Tecnologias e competências',
            subheading: null,
            period: null,
            sourceIds: [SKILL_TS_ID, SKILL_NODE_ID],
            bullets: [
              {
                id: 'skills-1-b1',
                text: 'TypeScript',
                sourceIds: [SKILL_TS_ID],
                origin: 'generated',
              },
              {
                id: 'skills-1-b2',
                text: 'Node.js',
                sourceIds: [SKILL_NODE_ID],
                origin: 'generated',
              },
            ],
          },
        ],
      },
      {
        id: 'experience',
        kind: 'experience',
        title: 'Experiência',
        entries: [
          {
            id: 'experience-1',
            heading: 'Dev Backend — Acme',
            subheading: null,
            period: '2020-01 – atual',
            sourceIds: [EXPERIENCE_ID],
            bullets: [
              {
                id: 'experience-1-b1',
                text: 'Construí APIs REST em Node.js.',
                sourceIds: [EXP_ITEM_ID],
                origin: 'generated',
              },
            ],
          },
        ],
      },
    ],
  });
}

/** Conteudo com um item apontando para um registro que nao existe no perfil. */
export function contentWithGap(): ResumeContent {
  const content = makeContent();
  const entry = content.sections[2]?.entries[0];
  entry?.bullets.push({
    id: 'experience-1-b2',
    text: 'Liderei a migração de serviços.',
    sourceIds: [MISSING_ID],
    origin: 'edited',
  });
  return content;
}

export const GAP_ISSUE: ResumeIssue = {
  severity: 'error',
  code: 'UNKNOWN_SOURCE',
  path: 'sections.2.entries.0.bullets.1',
  message: 'O item cita um registro que não existe no perfil.',
};

export const WARNING_ISSUE: ResumeIssue = {
  severity: 'warning',
  code: 'UNSUPPORTED_TERM',
  path: 'sections.2.entries.0.bullets.0',
  message: 'O texto menciona termos que não aparecem nos registros de origem: REST.',
};

export function makeVersion(
  options: {
    id?: string;
    versionNumber?: number;
    status?: 'draft' | 'approved';
    issues?: ResumeIssue[];
    content?: ResumeContent;
    updatedAt?: string;
  } = {},
): ResumeVersionDetail {
  const status = options.status ?? 'draft';
  const issues = options.issues ?? [];
  return resumeVersionDetailSchema.parse({
    id: options.id ?? V1,
    resumeId: RESUME_ID,
    versionNumber: options.versionNumber ?? 1,
    status,
    language: 'pt-BR',
    sourceVersionId: null,
    contentHash: 'a'.repeat(64),
    issueCounts: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
    createdAt: NOW,
    updatedAt: options.updatedAt ?? NOW,
    approvedAt: status === 'approved' ? NOW : null,
    content: options.content ?? makeContent(),
    issues,
    profileRevisionId: null,
    analysisId: null,
  });
}

export function makeResume(
  versions: ResumeVersionDetail[],
  name = 'Dev Backend — Acme',
): ResumeSummary {
  return resumeSummarySchema.parse({
    id: RESUME_ID,
    jobId: JOB_ID,
    name,
    createdAt: NOW,
    updatedAt: NOW,
    versions: [...versions]
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map(
        ({
          content: _content,
          issues: _issues,
          profileRevisionId: _revision,
          analysisId: _analysis,
          ...summary
        }) => summary,
      ),
  });
}

export const versionBody = (version: ResumeVersionDetail) =>
  jsonResponse(200, resumeVersionResponseSchema.parse({ version }));

export const resumeBody = (resume: ResumeSummary) =>
  jsonResponse(200, resumeResponseSchema.parse({ resume }));

export const listBody = (resumes: ResumeSummary[]) => jsonResponse(200, { resumes });

const ZERO_SUMMARY = {
  recordCount: 0,
  byStatus: { confirmed: 0, needs_review: 0, conflicting: 0, archived: 0 },
  pending: { open: 0, resolved: 0, dismissed: 0 },
  evidenceCount: 0,
  byKind: {},
};

/** Perfil que contem as fontes citadas por `makeContent()`. */
export function profileState() {
  const confirmed = { status: 'confirmed' };
  return profileStateResponseSchema.parse({
    exists: true,
    profile: {
      id: ID(9),
      storedSchemaVersion: '2.1.0',
      createdAt: NOW,
      updatedAt: NOW,
    },
    document: profileDocumentSchema.parse({
      schema_version: '2.1.0',
      profile: {
        contact_points: [
          { id: CONTACT_ID, kind: 'email', value: 'ana@example.com', visibility: 'public' },
        ],
        statements: [
          {
            id: STATEMENT_ID,
            kind: 'short_summary',
            text: 'Desenvolvedora backend com foco em APIs.',
            meta: confirmed,
          },
        ],
        skills: [
          { id: SKILL_TS_ID, name: 'TypeScript', meta: confirmed },
          { id: SKILL_NODE_ID, name: 'Node.js', meta: confirmed },
        ],
        experiences: [
          {
            id: EXPERIENCE_ID,
            display_title: 'Dev Backend',
            organization_name: 'Acme',
            meta: confirmed,
            items: [
              {
                id: EXP_ITEM_ID,
                kind: 'responsibility',
                text: 'Construí APIs REST em Node.js.',
                meta: confirmed,
              },
            ],
          },
        ],
      },
    }),
    summary: { ...ZERO_SUMMARY, recordCount: 6 },
  });
}

export function installProfile(fake: FakeApi): void {
  fake.on('GET /api/profile', jsonResponse(200, profileState()));
}

export function fileResponse(filename: string, contentType: string): Response {
  return new Response(new Blob(['conteudo do arquivo'], { type: contentType }), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

/** Mesma regra de origem do servidor: texto alterado deixa de ser "generated"; id novo e "added". */
export function reconcile(previous: ResumeContent, next: ResumeContent): ResumeContent {
  const before = new Map(
    previous.sections.flatMap((section) =>
      section.entries.flatMap((entry) =>
        entry.bullets.map((bullet) => [bullet.id, bullet] as const),
      ),
    ),
  );
  return {
    ...next,
    sections: next.sections.map((section) => ({
      ...section,
      entries: section.entries.map((entry) => ({
        ...entry,
        bullets: entry.bullets.map((bullet) => {
          const old = before.get(bullet.id);
          if (old === undefined) return { ...bullet, origin: 'added' as const };
          if (old.text !== bullet.text) {
            return {
              ...bullet,
              origin: old.origin === 'added' ? ('added' as const) : ('edited' as const),
            };
          }
          return { ...bullet, origin: old.origin };
        }),
      })),
    })),
  };
}
