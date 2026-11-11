import type { Prisma } from '../generated/prisma/client';

/**
 * Export registry (ADR-0014, "Exportar tudo"). EVERY table of the schema is either part of the account
 * export (with the section of `AccountExport` that carries it) or explicitly excluded with a reason.
 * `Record<Prisma.ModelName, ...>` makes a new model a compile error until it is classified, and
 * `test/account-export-registry.test.ts` checks the same against the generated client and the live
 * catalog. Secrets are never exported: `withheld` lists the columns deliberately left out of an
 * exported table, and the export test plants canary values in them.
 */
export const EXPORT_SECTIONS = [
  'account',
  'credentials',
  'sessions',
  'invitations',
  'consents',
  'auditEvents',
  'profileBase',
  'profileRevisions',
  'jobs',
  'jobAnalyses',
  'resumes',
  'resumeVersions',
] as const;
export type ExportSection = (typeof EXPORT_SECTIONS)[number];

export type ExportClassification =
  | {
      status: 'exported';
      section: ExportSection;
      /** Columns of this table that are NOT exported (secrets or pure internals). */
      withheld?: readonly string[];
      note?: string;
    }
  | { status: 'excluded'; reason: string };

export const ACCOUNT_EXPORT_REGISTRY = {
  User: {
    status: 'exported',
    section: 'account',
    note: 'Identity of the account holder (e-mail, display name, status, dates).',
  },
  Credential: {
    status: 'exported',
    section: 'credentials',
    withheld: ['passwordHash'],
    note: 'Only the kind and the dates; the argon2id hash is a secret.',
  },
  Session: {
    status: 'exported',
    section: 'sessions',
    withheld: ['tokenHash'],
    note: 'Session metadata (dates, truncated user agent); the token hash is a secret.',
  },
  Invite: {
    status: 'exported',
    section: 'invitations',
    withheld: ['tokenHash', 'email', 'usedByUserId'],
    note: 'Only the invitation this account accepted (dates); not the token hash.',
  },
  ConsentRecord: { status: 'exported', section: 'consents' },
  AuditEvent: {
    status: 'exported',
    section: 'auditEvents',
    note: 'Events about the account; metadata never carries personal content (ADR-0014).',
  },
  ProfileBase: {
    status: 'exported',
    section: 'profileBase',
    note: 'The professional base: CV and profile/rules in Markdown.',
  },
  ProfileBaseRevision: {
    status: 'exported',
    section: 'profileRevisions',
    note: 'Immutable snapshots of the professional base.',
  },
  JobPosting: {
    status: 'exported',
    section: 'jobs',
    note: 'Saved job postings: original text, metadata, status and notes.',
  },
  JobAnalysis: {
    status: 'exported',
    section: 'jobAnalyses',
    note: 'Derived evaluations of saved jobs (score, requirements, gaps, keywords).',
  },
  Resume: {
    status: 'exported',
    section: 'resumes',
    note: 'Resume per saved job (name and dates); the content lives in its versions.',
  },
  ResumeVersion: {
    status: 'exported',
    section: 'resumeVersions',
    note: 'Resume versions: structured content, status and links to the base revision and evaluation used.',
  },
  AccountDeletion: {
    status: 'excluded',
    reason:
      'Minimal deletion record with no reference to any owner: it cannot belong to an account being exported.',
  },
} as const satisfies Record<Prisma.ModelName, ExportClassification>;

export type ExportedModelName = keyof typeof ACCOUNT_EXPORT_REGISTRY;

/** Names that are in `names` but have no classification (used by the completeness test). */
export function unclassifiedModels(names: Iterable<string>): string[] {
  const known = new Set<string>(Object.keys(ACCOUNT_EXPORT_REGISTRY));
  return [...names].filter((name) => !known.has(name)).sort();
}
