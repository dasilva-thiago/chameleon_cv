import {
  createAiRouter,
  type AiLimits,
  type AiProvider,
  type AiRouter,
  type BudgetStore,
} from '@chameleon/ai';
import { KNOWN_PROVIDERS } from '@chameleon/ai';
import type { AiStatusResponse } from '@chameleon/contracts';
import type { AuthContext } from '../auth/context';
import { hasGrantedConsent } from '../consent';

/**
 * AI access of the API. The router is built per request (its budget ledger and consent gate are bound to the
 * authenticated owner); the pause state of the providers is shared by all requests.
 *
 * Budget ledger: every provider request writes one `ai.usage` audit event with counts only (provider, requests,
 * tokens). No prompt, no answer, no profile or job text is ever stored.
 */

export const AI_USAGE_ACTION = 'ai.usage';
export const consentPurposeOf = (providerId: string): string => `ai_processing:${providerId}`;

export type AiAccessReason = 'ok' | 'off' | 'unconfigured' | 'no_consent';

export interface AiAccess {
  router: AiRouter | null;
  reason: AiAccessReason;
}

export interface AiService {
  readonly mode: 'auto' | 'deterministic';
  readonly limits: Required<AiLimits>;
  /** Providers with a key, in order. */
  providers(): { id: string; label: string; model: string; note: string }[];
  /** A router for this owner, or why there is none. */
  access(auth: AuthContext): Promise<AiAccess>;
  status(auth: AuthContext): Promise<AiStatusResponse>;
  setConsent(auth: AuthContext, granted: boolean, policyVersion: string): Promise<void>;
}

const startOfDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const nextDay = (day: string): Date => new Date(startOfDay(day).getTime() + 24 * 60 * 60 * 1000);

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Budget counters kept in the owner's audit events (one UTC day per query). */
export function ledgerBudget(auth: AuthContext): BudgetStore {
  return {
    async usage(providerId, day) {
      const events = await auth.db.auditEvent.findMany({
        where: {
          action: AI_USAGE_ACTION,
          entityId: providerId,
          at: { gte: startOfDay(day), lt: nextDay(day) },
        },
        select: { metadata: true },
      });
      let requests = 0;
      let tokens = 0;
      for (const event of events) {
        const metadata = (event.metadata ?? {}) as Record<string, unknown>;
        requests += count(metadata.requests);
        tokens += count(metadata.tokens);
      }
      return { requests, tokens };
    },
    async record(providerId, day, delta) {
      await auth.db.auditEvent.create({
        data: {
          ownerId: auth.ownerId,
          action: AI_USAGE_ACTION,
          entityType: 'AiProvider',
          entityId: providerId,
          metadata: { day, requests: delta.requests, tokens: delta.tokens },
        },
      });
    },
  };
}

export interface AiServiceOptions {
  mode: 'auto' | 'deterministic';
  providers: readonly AiProvider[];
  limits: Required<AiLimits>;
  now?: () => Date;
}

export function createAiService(options: AiServiceOptions): AiService {
  const providers = options.mode === 'auto' ? options.providers : [];
  const cooldowns = new Map<string, number>();
  const now = options.now ?? (() => new Date());
  const noteOf = (id: string): string => KNOWN_PROVIDERS.find((p) => p.id === id)?.note ?? '';

  async function consented(auth: AuthContext): Promise<Set<string>> {
    const granted = new Set<string>();
    for (const provider of providers) {
      if (await hasGrantedConsent(auth.db, auth.ownerId, consentPurposeOf(provider.spec.id))) {
        granted.add(provider.spec.id);
      }
    }
    return granted;
  }

  return {
    mode: options.mode,
    limits: options.limits,
    providers: () =>
      providers.map((provider) => ({
        id: provider.spec.id,
        label: provider.spec.label,
        model: provider.spec.model,
        note: noteOf(provider.spec.id),
      })),

    async access(auth) {
      if (options.mode === 'deterministic') return { router: null, reason: 'off' };
      if (providers.length === 0) return { router: null, reason: 'unconfigured' };
      const granted = await consented(auth);
      if (granted.size === 0) return { router: null, reason: 'no_consent' };
      return {
        router: createAiRouter({
          providers,
          budget: ledgerBudget(auth),
          limits: options.limits,
          allowed: (id) => granted.has(id),
          cooldowns,
          now,
        }),
        reason: 'ok',
      };
    },

    async status(auth) {
      const granted = providers.length > 0 ? await consented(auth) : new Set<string>();
      const day = now().toISOString().slice(0, 10);
      const budget = ledgerBudget(auth);
      let requests = 0;
      let tokens = 0;
      for (const provider of providers) {
        const used = await budget.usage(provider.spec.id, day);
        requests += used.requests;
        tokens += used.tokens;
      }
      const all = providers.length > 0 && providers.every((p) => granted.has(p.spec.id));
      return {
        mode: options.mode,
        configured: options.mode === 'auto' && providers.length > 0,
        providers: providers.map((provider) => ({
          id: provider.spec.id,
          label: provider.spec.label,
          model: provider.spec.model,
          note: noteOf(provider.spec.id),
          consented: granted.has(provider.spec.id),
        })),
        consented: all,
        active: granted.size > 0,
        usageToday: { requests, tokens },
        limits: {
          totalDailyRequests: options.limits.totalDailyRequests,
          totalDailyTokens: options.limits.totalDailyTokens,
        },
      };
    },

    async setConsent(auth, granted, policyVersion) {
      for (const provider of providers) {
        await auth.db.consentRecord.create({
          data: {
            ownerId: auth.ownerId,
            purpose: consentPurposeOf(provider.spec.id),
            granted,
            policyVersion,
          },
        });
      }
    },
  };
}

/** AI off: used by tests and when nothing is configured. */
export const disabledAiService: AiService = createAiService({
  mode: 'deterministic',
  providers: [],
  limits: { totalDailyRequests: 1, totalDailyTokens: 1 },
});
