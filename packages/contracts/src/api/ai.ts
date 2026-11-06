import { z } from 'zod';

/**
 * Uso de IA (provedores externos): estado e consentimento. O perfil só é enviado a um provedor com consentimento
 * explícito dele (`ai_processing:<id>`), e só os fatos selecionados (sem contatos nem itens privados).
 */

export const aiProviderInfoSchema = z.strictObject({
  id: z.string().max(40),
  label: z.string().max(80),
  model: z.string().max(120),
  /** Aviso curto sobre o plano (ex.: dados do plano gratuito podem ser usados pelo provedor). */
  note: z.string().max(300),
  consented: z.boolean(),
});
export type AiProviderInfo = z.infer<typeof aiProviderInfoSchema>;

const countSchema = z.number().int().nonnegative();

export const aiStatusResponseSchema = z.strictObject({
  /** `auto` usa os provedores com chave; `deterministic` nunca chama IA. */
  mode: z.enum(['auto', 'deterministic']),
  /** Há pelo menos um provedor com chave e o modo é `auto`. */
  configured: z.boolean(),
  providers: z.array(aiProviderInfoSchema).max(20),
  /** Todos os provedores configurados têm consentimento. */
  consented: z.boolean(),
  /** A IA será usada na próxima análise ou currículo (configurada e consentida). */
  active: z.boolean(),
  usageToday: z.strictObject({ requests: countSchema, tokens: countSchema }),
  limits: z.strictObject({ totalDailyRequests: countSchema, totalDailyTokens: countSchema }),
});
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;

/** `PUT /api/ai/consent`: concede ou retira o consentimento para TODOS os provedores configurados. */
export const setAiConsentRequestSchema = z.strictObject({ granted: z.boolean() });
export type SetAiConsentRequest = z.input<typeof setAiConsentRequestSchema>;
