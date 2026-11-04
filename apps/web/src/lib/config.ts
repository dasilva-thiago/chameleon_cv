export const APP_NAME = 'ChameleonCV';

/** Formato aceito pela API para `policyVersion` (contracts: consentInputSchema). */
const POLICY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Versao do texto de consentimento exibido no aceite de convite. Quando o texto em
 * `features/auth/consent-text.ts` mudar, atualize esta constante (ou defina
 * `VITE_PROFILE_POLICY_VERSION` no build). Um valor fora do formato da API e ignorado.
 */
export const DEFAULT_PROFILE_POLICY_VERSION = '2026-11.1';

export function resolvePolicyVersion(override: string | undefined): string {
  const candidate = override?.trim();
  return candidate !== undefined && POLICY_VERSION_PATTERN.test(candidate)
    ? candidate
    : DEFAULT_PROFILE_POLICY_VERSION;
}

export const PROFILE_POLICY_VERSION = resolvePolicyVersion(
  import.meta.env.VITE_PROFILE_POLICY_VERSION as string | undefined,
);
