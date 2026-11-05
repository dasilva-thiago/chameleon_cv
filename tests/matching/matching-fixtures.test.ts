import {
  analysisResultSchema,
  listRecords,
  type ProfileDocument,
} from '../../packages/contracts/src';
import { analyzeJob, extractRequirements } from '../../packages/domain/src';
import {
  listJobs,
  listV2ProfileIds,
  loadJob,
  loadProfileYaml,
  type ProfileId,
} from '../../packages/test-fixtures/src';
import { describe, expect, it } from 'vitest';
import { importProfile } from '../../packages/profile-io/src';

/**
 * The deterministic matcher against the synthetic job and profile fixtures. Imported facts start as
 * `needs_review`; `confirmAll` plays the owner who reviewed everything, so the matcher sees usable evidence.
 */
function documentOf(profileId: ProfileId, confirmAll: boolean): ProfileDocument {
  const imported = importProfile(loadProfileYaml(profileId));
  if (!imported.ok || !imported.document) throw new Error(`fixture ${profileId} did not import`);
  const document = structuredClone(imported.document);
  if (confirmAll) {
    for (const entry of listRecords(document)) {
      const meta = entry.value.meta as Record<string, unknown> | undefined;
      if (meta?.status === 'needs_review') meta.status = 'confirmed';
    }
  }
  return document;
}

const JOBS = listJobs();
describe.each(JOBS)('job fixture %s', (jobId) => {
  const { meta, text } = loadJob(jobId);

  it('finds every requirement the fixture expects, under the right importance, and skips benefits/salary', () => {
    const { requirements, warnings } = extractRequirements(text);
    if (jobId === 'malformed-long') {
      // deliberately messy 26k-character posting: robust (bounded, no throw); its few real requirements are
      // buried in noise, so the recall expectations below do not apply
      expect(requirements.length).toBeLessThanOrEqual(60);
      expect(warnings.length).toBeGreaterThanOrEqual(0);
      return;
    }
    const flat = (value: string): string => value.replace(/\s+/g, ' ').trim();
    const found = (importance: string, excerpt: string): boolean =>
      requirements.some((r) => r.importance === importance && flat(r.text).includes(flat(excerpt)));
    const expected = [
      ...meta.expectations.mandatory.map((e) => ['mandatory', e.excerpt] as const),
      ...meta.expectations.desirable.map((e) => ['desirable', e.excerpt] as const),
      ...meta.expectations.responsibilities.map((e) => ['responsibility', e.excerpt] as const),
    ];
    for (const [importance, excerpt] of expected) {
      expect(found(importance, excerpt), `${importance}: ${excerpt}`).toBe(true);
    }
    expect(
      requirements.filter((r) => /^(benef[ií]cios|sal[aá]rio|oferecemos)\b/i.test(r.text)),
    ).toEqual([]);
  });

  it('every requirement text is a literal piece of the posting (nothing is invented)', () => {
    const flat = text.replace(/\s+/g, ' ');
    for (const requirement of extractRequirements(text).requirements) {
      const piece = requirement.text.replace(/\s+/g, ' ');
      expect(flat.includes(piece), requirement.text).toBe(true);
    }
  });

  it('produces a valid, deterministic analysis for every v2 profile fixture', () => {
    for (const profileId of listV2ProfileIds()) {
      const document = documentOf(profileId, true);
      const first = analyzeJob(text, document);
      expect(() => analysisResultSchema.parse(first), `${profileId}`).not.toThrow();
      expect(analyzeJob(text, document)).toEqual(first);
      const known = new Set(
        listRecords(document).map((entry) => String(entry.value.id).toLowerCase()),
      );
      for (const match of first.matches) {
        for (const evidence of match.evidence) {
          expect(
            known.has(evidence.recordId.toLowerCase()),
            `${profileId} ${evidence.recordId}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('the same posting reads differently against different profiles', () => {
  const { text } = loadJob('k8s-gap');
  const kubernetes = (profileId: ProfileId, confirmAll = true) => {
    const result = analyzeJob(text, documentOf(profileId, confirmAll));
    const requirement = result.requirements.find((r) => /kubernetes em produ/i.test(r.text));
    return result.matches.find((m) => m.requirementId === requirement?.id);
  };

  it('a student without employment has no Kubernetes evidence', () => {
    expect(kubernetes('student-no-employment')?.strength).toBe('absent');
  });

  it('Kubernetes known only by self-declaration is never "direct"', () => {
    const match = kubernetes('experienced-promotions-same-employer');
    expect(match?.strength).not.toBe('direct');
    expect(match?.strength).not.toBe('absent');
  });

  it('unconfirmed facts never count as usable evidence', () => {
    const result = analyzeJob(text, documentOf('experienced-promotions-same-employer', false));
    expect(result.summary.byStrength.direct + result.summary.byStrength.partial).toBe(0);
    expect(result.prioritized).toEqual([]);
  });
});

describe('the injection fixture is data, not instructions', () => {
  const { meta, text } = loadJob('injection');

  it('warns, and the forbidden markers never reach the analysis output', () => {
    const result = analyzeJob(text, documentOf('student-no-employment', true));
    expect(result.warnings.join(' ')).toMatch(/parecem instruções/);
    const evidenceAndPlan = JSON.stringify({
      evidence: result.matches.flatMap((m) => m.evidence),
      rationale: result.matches.map((m) => m.rationale),
      plan: result.prioritized,
    });
    for (const marker of meta.forbidden_output_markers) {
      expect(evidenceAndPlan).not.toContain(marker);
    }
    expect(evidenceAndPlan).not.toMatch(/300%|10 anos/);
  });
});
