import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listRecords } from '@chameleon/contracts';
import { loadProfile, parseProfileMarkdown } from '../src/index';
import { expectedAfterMarkdown, renderProfileMarkdown } from './markdown-render';

const PROFILES_DIR = resolve(__dirname, '../../test-fixtures/profiles');
const FIXTURES = readdirSync(PROFILES_DIR)
  .filter((name) => name.endsWith('.yaml') && !name.startsWith('legacy-'))
  .sort();

describe('round trip: canonical fixture -> filled Markdown -> parseProfileMarkdown', () => {
  it('covers the 12 synthetic v2 fixtures', () => {
    expect(FIXTURES).toHaveLength(12);
  });

  describe.each(FIXTURES)('%s', (name) => {
    const yaml = readFileSync(join(PROFILES_DIR, name), 'utf8');
    const canonical = loadProfile(yaml).document;

    it('loads the fixture', () => {
      expect(canonical).not.toBeNull();
    });

    // Without headings, record boundaries come from `id` lines and repeated fields. That is only
    // reliable when every record has an id (see the limitation test below).
    const allHaveIds = listRecords(canonical).every((entry) => entry.id !== null);
    const variants: [string, { recordHeadings: boolean; childHeadings: boolean }][] = [
      ['record headings', { recordHeadings: true, childHeadings: true }],
    ];
    if (allHaveIds) {
      variants.push(['no headings', { recordHeadings: false, childHeadings: false }]);
    }

    it.each(variants)('reads the form back without loss (%s)', (_label, options) => {
      const markdown = renderProfileMarkdown(canonical as never, options);
      const parsed = loadProfile(markdown, { format: 'markdown' });
      expect(parsed.report.errors).toEqual([]);
      expect(parsed.ok).toBe(true);
      const expected = loadProfile(expectedAfterMarkdown(canonical) as Record<string, unknown>);
      expect(expected.report.errors).toEqual([]);
      expect(parsed.document).toEqual(expected.document);
    });

    it('survives CRLF line endings and a UTF-8 BOM', () => {
      const lf = renderProfileMarkdown(canonical as never);
      const crlf = renderProfileMarkdown(canonical as never, { eol: '\r\n', bom: true });
      const a = parseProfileMarkdown(lf);
      const b = parseProfileMarkdown(crlf);
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) expect(b.data).toEqual(a.data);
    });
  });
});
