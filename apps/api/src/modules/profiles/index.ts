import type { ApiModule } from '../../app';
import { profileRoutes } from './gate';
import { registerEvidenceRoutes } from './routes-evidence';
import { registerExportRoutes } from './routes-export';
import { registerImportRoutes } from './routes-imports';
import { registerRecordRoutes } from './routes-records';
import { registerRevisionRoutes } from './routes-revisions';
import { registerStateRoutes } from './routes-state';
import {
  DEFAULT_PREVIEW_CACHE,
  DEFAULT_PREVIEW_QUOTA,
  OwnerLocks,
  OwnerQuota,
  PreviewCache,
  type PreviewCacheOptions,
  type QuotaOptions,
} from './scope';

export { isLargeBodyRoute } from './import-input';
export { requireProfileConsent } from './gate';

export interface ProfilesModuleOptions {
  /** Overrides for tests (TTL, bounds). */
  previewCache?: Partial<PreviewCacheOptions>;
  /** Per-owner quota of import previews (default 30 per 10 minutes). */
  previewQuota?: Partial<QuotaOptions>;
  now?: () => Date;
}

/**
 * Profile module (S2.1a): `/api/profile/**`. Every route is declared through `profileRoutes`, which puts the
 * session guard, the `profile_processing` consent gate and the owner-bound scope in front of the handlers.
 * See `apps/api/README.md` for the route table and `packages/contracts/src/api/profile.ts` for the DTOs.
 */
export function createProfilesModule(options: ProfilesModuleOptions = {}): ApiModule {
  return ({ routes, profileStore, config }) => {
    const now = options.now ?? (() => new Date());
    const profile = profileRoutes(routes, {
      store: profileStore,
      locks: new OwnerLocks(),
      cache: new PreviewCache({ ...DEFAULT_PREVIEW_CACHE, ...options.previewCache }, () =>
        now().getTime(),
      ),
      previewQuota: new OwnerQuota({ ...DEFAULT_PREVIEW_QUOTA, ...options.previewQuota }, () =>
        now().getTime(),
      ),
    });
    registerStateRoutes(profile, config);
    registerRecordRoutes(profile);
    registerEvidenceRoutes(profile);
    registerRevisionRoutes(profile);
    registerImportRoutes(profile, config);
    registerExportRoutes(profile, now);
  };
}
