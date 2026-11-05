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
  'profiles',
  'revisions',
  'imports',
  'jobs',
  'jobAnalyses',
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

const viaProfile = (note: string): ExportClassification => ({
  status: 'exported',
  section: 'profiles',
  note,
});

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
  ProfessionalProfile: viaProfile('Profile root: exported inside the canonical profile document.'),
  ProfileFact: viaProfile('Governance of a fact: inside the profile document (`meta`).'),
  ProfileStatement: viaProfile('Profile document.'),
  CompetencyExample: viaProfile('Profile document.'),
  CompetencyExampleSkill: viaProfile('Link table: serialized as references in the document.'),
  Experience: viaProfile('Profile document.'),
  ExperienceItem: viaProfile('Profile document.'),
  Project: viaProfile('Profile document.'),
  ProjectItem: viaProfile('Profile document.'),
  ProjectCollaborator: viaProfile('Profile document.'),
  Education: viaProfile('Profile document.'),
  Course: viaProfile('Profile document.'),
  Skill: viaProfile('Profile document.'),
  SkillUsage: viaProfile('Profile document.'),
  LanguageProficiency: viaProfile('Profile document.'),
  Certification: viaProfile('Profile document.'),
  Award: viaProfile('Profile document.'),
  Publication: viaProfile('Profile document.'),
  Volunteering: viaProfile('Profile document.'),
  ContactPoint: viaProfile('Profile document.'),
  Evidence: viaProfile('Profile document.'),
  EvidenceLink: viaProfile('Link table: serialized as `supports` / `evidence_ids`.'),
  PendingItem: viaProfile('Profile document.'),
  UsageRestriction: viaProfile('Profile document.'),
  ProfileRevision: {
    status: 'exported',
    section: 'revisions',
    note: 'Revision metadata plus the full immutable snapshot.',
  },
  ImportRecord: {
    status: 'exported',
    section: 'imports',
    note:
      'Import reports (steps, warnings, id map, unmapped values, summary). The raw uploaded file is not ' +
      'stored in this table; stored files are exported by the storage layer (S2.x).',
  },
  JobPosting: {
    status: 'exported',
    section: 'jobs',
    note: 'Saved job postings: original text, metadata, status and notes.',
  },
  JobAnalysis: {
    status: 'exported',
    section: 'jobAnalyses',
    note: 'Derived analyses of saved jobs (requirements, matches, plan) and the owner review.',
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
