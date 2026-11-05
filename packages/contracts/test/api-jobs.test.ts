import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_STATUSES,
  JOB_STATUSES,
  createJobRequestSchema,
  listJobsQuerySchema,
  patchJobRequestSchema,
} from '../src/index';

describe('jobs contract', () => {
  it('requires only the description; blank optional text becomes null', () => {
    const parsed = createJobRequestSchema.parse({ description: 'Texto', title: '  ', url: '' });
    expect(parsed).toMatchObject({ description: 'Texto', title: null, url: null });
    expect(createJobRequestSchema.safeParse({ title: 'x' }).success).toBe(false);
  });

  it('keeps the description exactly as pasted (no trim, CRLF preserved)', () => {
    const text = '  linha 1\r\n\tlinha 2  \n';
    expect(createJobRequestSchema.parse({ description: text }).description).toBe(text);
  });

  it('accepts only http(s) urls without credentials', () => {
    const ok = (url: string) => createJobRequestSchema.safeParse({ description: 'x', url }).success;
    expect(ok('https://exemplo.test/a?b=1')).toBe(true);
    expect(ok('http://exemplo.test')).toBe(true);
    expect(ok('ftp://exemplo.test')).toBe(false);
    expect(ok('javascript:alert(1)')).toBe(false);
    expect(ok('https://a:b@exemplo.test')).toBe(false);
  });

  it('rejects unknown keys, NUL and impossible dates', () => {
    const parse = (body: unknown) => createJobRequestSchema.safeParse(body).success;
    expect(parse({ description: 'x', ownerId: 'y' })).toBe(false);
    expect(parse({ description: 'a\u0000b' })).toBe(false);
    expect(parse({ description: 'x', postedOn: '2026-02-30' })).toBe(false);
    expect(parse({ description: 'x', postedOn: '2026-02-28' })).toBe(true);
  });

  it('patch needs at least one field and keeps null (clear) distinct from absent', () => {
    expect(patchJobRequestSchema.safeParse({}).success).toBe(false);
    const cleared = patchJobRequestSchema.parse({ company: null });
    expect(cleared.company).toBeNull();
    expect('title' in cleared).toBe(false);
  });

  it('list query defaults to active jobs and limits the page', () => {
    expect(listJobsQuerySchema.parse({})).toMatchObject({ status: 'active', limit: 100 });
    expect(listJobsQuerySchema.parse({ q: '  ' }).q).toBeUndefined();
    expect(listJobsQuerySchema.safeParse({ status: 'hired' }).success).toBe(false);
    expect(listJobsQuerySchema.safeParse({ limit: 201 }).success).toBe(false);
  });

  it('active statuses are a strict subset that excludes closed and archived', () => {
    expect(ACTIVE_JOB_STATUSES.every((s) => JOB_STATUSES.includes(s))).toBe(true);
    expect(ACTIVE_JOB_STATUSES).not.toContain('closed');
    expect(ACTIVE_JOB_STATUSES).not.toContain('archived');
  });
});
