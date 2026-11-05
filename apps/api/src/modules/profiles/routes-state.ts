import {
  profileSectionSchema,
  profileSectionValueSchema,
  saveProfileRequestSchema,
  saveSectionRequestSchema,
  type ProfileSection,
} from '@chameleon/contracts';
import { cloneJson } from '@chameleon/contracts';
import type { AppConfig } from '../../config';
import type { Json } from './doc';
import { notFound, parseDto, validationError, zodDetails } from './errors';
import type { ProfileRoutes } from './gate';
import { largeJsonBody } from './import-input';
import { commit, loadBase } from './save';
import { scopeOf } from './scope';
import { stateResponse } from './views';

function sectionParam(value: unknown): ProfileSection {
  const parsed = profileSectionSchema.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export function registerStateRoutes(
  profile: ProfileRoutes,
  config: Pick<AppConfig, 'UPLOAD_MAX_BYTES'>,
): void {
  const jsonBody = largeJsonBody(config.UPLOAD_MAX_BYTES);
  profile.get(
    '/',
    'Profile state: document, summary and counters (exists=false before the first save).',
    async (_req, res) => {
      const scope = scopeOf(res);
      res.json(stateResponse(await scope.store.loadProfileDocument()));
    },
  );

  profile.put(
    '/',
    'Save the whole document (onMissing keep|archive|delete; default keep).',
    jsonBody,
    async (req, res) => {
      const scope = scopeOf(res);
      const body = parseDto(saveProfileRequestSchema, req.body);
      const result = await scope.exclusive(async () => {
        const { base } = await loadBase(scope);
        return commit(scope, base, body.document, {
          onMissing: body.onMissing,
          createRevision: body.createRevision,
        });
      });
      await scope.audit('profile.save', 'ProfessionalProfile', result.profileId, {
        scope: 'document',
        onMissing: body.onMissing,
        created: result.save.summary.totals.created,
        updated: result.save.summary.totals.updated,
      });
      res.json({ save: result.save, state: result.state });
    },
  );

  profile.get(
    '/sections/:section',
    'Read one section (singleton block or record list).',
    async (req, res) => {
      const section = sectionParam(req.params.section);
      const loaded = await scopeOf(res).store.loadProfileDocument();
      const value = loaded ? ((loaded.document.profile as Json)[section] ?? null) : null;
      res.json({ section, value });
    },
  );

  profile.put(
    '/sections/:section',
    'Replace one section; omitted records are kept unless onMissing says otherwise.',
    jsonBody,
    async (req, res) => {
      const scope = scopeOf(res);
      const section = sectionParam(req.params.section);
      const body = parseDto(saveSectionRequestSchema, req.body);
      const checked = profileSectionValueSchema(section).safeParse(body.value);
      if (!checked.success) throw validationError(zodDetails(checked.error.issues, 'value'));
      const result = await scope.exclusive(async () => {
        const { base } = await loadBase(scope);
        const next = cloneJson(base);
        const profile = next.profile as Json;
        if (checked.data === null || checked.data === undefined) delete profile[section];
        else profile[section] = checked.data;
        return commit(scope, base, next, {
          onMissing: body.onMissing,
          createRevision: body.createRevision,
        });
      });
      await scope.audit('profile.save', 'ProfessionalProfile', result.profileId, {
        scope: 'section',
        section,
        onMissing: body.onMissing,
        created: result.save.summary.totals.created,
        updated: result.save.summary.totals.updated,
      });
      res.json({ save: result.save, state: result.state });
    },
  );
}
