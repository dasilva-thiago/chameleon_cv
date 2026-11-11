import type { RequestHandler } from 'express';
import { requireAuthContext } from '../auth/context';
import { HttpError } from '../http/errors';
import { hasGrantedConsent } from './consent';

export const PROFILE_CONSENT_PURPOSE = 'profile_processing';

/**
 * Consent gate: every route that reads or writes the professional base (or derives something from it) is refused
 * unless the LATEST `profile_processing` record of the caller is `granted` (a later withdrawal wins; no record = no
 * consent). Runs after the session guard, before any body is processed.
 */
export const requireProfileConsent: RequestHandler = async (req, _res, next) => {
  const auth = requireAuthContext(req);
  const granted = await hasGrantedConsent(auth.db, auth.ownerId, PROFILE_CONSENT_PURPOSE);
  if (!granted) {
    throw new HttpError(
      403,
      'CONSENT_REQUIRED_FOR_PROFILE',
      'O consentimento para tratar os dados do perfil e necessario para usar esta funcao.',
    );
  }
  next();
};
