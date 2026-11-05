import { EXPORT_CONTENT_TYPES, exportQuerySchema } from '@chameleon/contracts';
import { serializeProfile } from '@chameleon/profile-io';
import { notFound, parseDto } from './errors';
import type { ProfileRoutes } from './gate';
import { scopeOf } from './scope';

/** Neutral file name: fixed prefix + server date. Nothing from the profile (no name, no company) ever reaches a header. */
export function exportFileName(format: 'yaml' | 'json', now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `chameleon-profile-${day}.${format}`;
}

export function registerExportRoutes(profile: ProfileRoutes, now: () => Date): void {
  profile.get(
    '/export',
    'Export the profile as canonical v2.1.0 YAML or JSON (the owner receives everything, private fields included).',
    async (req, res) => {
      const scope = scopeOf(res);
      const query = parseDto(exportQuerySchema, req.query);
      const loaded = await scope.store.loadProfileDocument();
      if (!loaded) throw notFound();
      const text = serializeProfile(loaded.document, query.format);
      await scope.audit('profile.export', 'ProfessionalProfile', loaded.profileId, {
        format: query.format,
      });
      res.status(200);
      res.setHeader('Content-Type', EXPORT_CONTENT_TYPES[query.format]);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${exportFileName(query.format, now())}"`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(text);
    },
  );
}
