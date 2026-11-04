import { safeParseProfileDocument, type ProfileIssue } from '../src/index';

export const doc = (profile: unknown, extra: Record<string, unknown> = {}) => ({
  schema_version: '2.1.0',
  profile,
  ...extra,
});

export function issuesOf(input: unknown): ProfileIssue[] {
  const result = safeParseProfileDocument(input);
  return result.success ? [] : result.issues;
}

export const isValid = (input: unknown): boolean => safeParseProfileDocument(input).success;

/** Documento valido minimo com um registro de cada tipo referenciavel, para testes de integridade. */
export function referenceProfile(): Record<string, unknown> {
  return {
    skills: [{ id: 'SKL-1', name: 'Planejamento' }],
    experiences: [{ id: 'EXP-1', organization_name: 'Org A', employment_type: 'employee' }],
    projects: [{ id: 'PRJ-1', name: 'Projeto' }],
    education: [{ id: 'EDU-1', institution: 'Escola' }],
    courses: [{ id: 'CRS-1', name: 'Curso' }],
    certifications: [{ id: 'CERT-1', name: 'Cert' }],
    volunteering: [{ id: 'VOL-1', organization: 'ONG' }],
    evidence: [{ id: 'EVD-1', type: 'document', title: 'Doc' }],
  };
}
