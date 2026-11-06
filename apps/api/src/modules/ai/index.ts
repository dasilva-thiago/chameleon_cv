import { setAiConsentRequestSchema } from '@chameleon/contracts';
import type { ApiModule } from '../../app';
import { requireAuthContext } from '../../auth/context';
import { parseDto } from '../profiles/errors';

/**
 * `/api/ai`: whether AI is configured and consented, today's usage against the caps, and the consent switch.
 * Consent is per provider (`ai_processing:<id>`) and applies to the SELECTED profile facts and the job text only
 * (never contacts or private items); this route grants or withdraws it for every configured provider at once.
 */
export const createAiModule = (): ApiModule => (context) => {
  const { routes, ai, config } = context;

  routes.get(
    '/ai',
    {
      auth: 'session',
      description: 'AI status: providers with a key, consent, usage today and the daily caps.',
    },
    async (req, res) => {
      res.json(await ai.status(requireAuthContext(req)));
    },
  );

  routes.put(
    '/ai/consent',
    {
      auth: 'session',
      description:
        'Grant or withdraw the consent to send the selected profile facts and the job text to the configured AI providers.',
    },
    async (req, res) => {
      const auth = requireAuthContext(req);
      const body = parseDto(setAiConsentRequestSchema, req.body);
      const policyVersion = config.PROFILE_POLICY_VERSIONS[0] ?? '2026-11.1';
      await ai.setConsent(auth, body.granted, policyVersion);
      res.json(await ai.status(auth));
    },
  );
};
