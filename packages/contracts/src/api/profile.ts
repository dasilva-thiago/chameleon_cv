import { z } from 'zod';

/**
 * Base profissional (como no career-ops): dois textos em Markdown que a pessoa edita livremente.
 *
 * - `cvMarkdown`: o CV completo, fonte de verdade dos fatos (equivale ao `cv.md`). Todo curriculo gerado so pode
 *   afirmar o que esta aqui.
 * - `profileMarkdown`: alvos, regras que barram vagas, faixas salariais, politica de local, enquadramento por tipo
 *   de vaga e regras de escrita (equivale a `modes/_profile.md` + `modes/_custom.md`). Orienta a avaliacao e a
 *   adaptacao; nao introduz fatos sobre a pessoa.
 *
 * Cada gravacao com conteudo novo cria uma revisao imutavel. Curriculos guardam a revisao em que foram gerados, para
 * que a checagem de fatos de uma versao aprovada use a base daquela epoca.
 */

export const PROFILE_BASE_LIMITS = {
  cvChars: 40_000,
  profileChars: 30_000,
  revisionsListed: 50,
} as const;

// eslint-disable-next-line no-control-regex -- rejeitar NUL e controles (exceto \t \n \r)
const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

const markdown = (max: number) =>
  z
    .string()
    .max(max, `Use ate ${String(max)} caracteres.`)
    .regex(NO_CONTROL, 'Caractere invalido.');

const hash = z.string().regex(/^[0-9a-f]{64}$/);

export const profileBaseSchema = z.strictObject({
  cvMarkdown: markdown(PROFILE_BASE_LIMITS.cvChars),
  profileMarkdown: markdown(PROFILE_BASE_LIMITS.profileChars),
  /** Revisao que corresponde ao conteudo atual. */
  revisionId: z.uuid(),
  /** SHA-256 do conteudo (chave de cache das avaliacoes). */
  hash,
  updatedAt: z.iso.datetime(),
});
export type ProfileBase = z.infer<typeof profileBaseSchema>;

export const profileBaseResponseSchema = z.strictObject({
  /** null enquanto a base nao foi criada. */
  base: profileBaseSchema.nullable(),
});
export type ProfileBaseResponse = z.infer<typeof profileBaseResponseSchema>;

export const saveProfileBaseRequestSchema = z.strictObject({
  cvMarkdown: markdown(PROFILE_BASE_LIMITS.cvChars),
  profileMarkdown: markdown(PROFILE_BASE_LIMITS.profileChars),
});
export type SaveProfileBaseRequest = z.input<typeof saveProfileBaseRequestSchema>;

export const saveProfileBaseResponseSchema = z.strictObject({
  base: profileBaseSchema,
  /** false quando nada mudou (a revisao atual foi mantida). */
  changed: z.boolean(),
});
export type SaveProfileBaseResponse = z.infer<typeof saveProfileBaseResponseSchema>;

export const profileRevisionSummarySchema = z.strictObject({
  id: z.uuid(),
  hash,
  cvChars: z.number().int().nonnegative(),
  profileChars: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
});
export type ProfileRevisionSummary = z.infer<typeof profileRevisionSummarySchema>;

export const listProfileRevisionsResponseSchema = z.strictObject({
  revisions: z.array(profileRevisionSummarySchema),
});
export type ListProfileRevisionsResponse = z.infer<typeof listProfileRevisionsResponseSchema>;

export const profileRevisionResponseSchema = z.strictObject({
  revision: profileRevisionSummarySchema.extend({
    cvMarkdown: z.string(),
    profileMarkdown: z.string(),
  }),
});
export type ProfileRevisionResponse = z.infer<typeof profileRevisionResponseSchema>;

// --- Como o programa leu a base -------------------------------------------------------------------------------

const readText = z.string().max(300);
const count = z.number().int().nonnegative();

/**
 * `POST /api/profile/reading`: o que o programa reconhece no texto enviado (salvo ou ainda nao), sem gravar nada e
 * sem IA. E o que as checagens dos curriculos usam (cargo exato por empresa, ordem das experiencias, expressoes a
 * evitar), entao a pessoa pode conferir antes de gerar um curriculo.
 */
export const baseReadingSchema = z.strictObject({
  cv: z.strictObject({
    name: readText.nullable(),
    headline: readText.nullable(),
    location: readText.nullable(),
    contacts: z.strictObject({ email: count, phone: count, link: count }),
    summaryParagraphs: count,
    experiences: z
      .array(
        z.strictObject({
          company: readText,
          title: readText.nullable(),
          period: readText.nullable(),
          bullets: count,
        }),
      )
      .max(60),
    projects: z.array(z.strictObject({ name: readText, bullets: count })).max(60),
    education: z
      .array(
        z.strictObject({
          institution: readText,
          course: readText.nullable(),
          period: readText.nullable(),
        }),
      )
      .max(30),
    skills: z.array(z.strictObject({ group: readText, items: count })).max(40),
    languages: count,
    courses: count,
  }),
  profile: z.strictObject({
    /** Lista "Expressoes a evitar" (erro de checagem quando aparecem num curriculo). */
    avoid: z.array(readText).max(100),
    /** Idioma dos curriculos. */
    language: readText,
  }),
});
export type BaseReading = z.infer<typeof baseReadingSchema>;

export const baseReadingResponseSchema = z.strictObject({ reading: baseReadingSchema });
export type BaseReadingResponse = z.infer<typeof baseReadingResponseSchema>;
