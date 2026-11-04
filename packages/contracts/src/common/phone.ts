import { z } from 'zod';

/**
 * Telefone (contrato 2.1.0).
 *
 * - FORMA CANONICA (a que o importador grava): `+` opcional seguido somente de digitos, de 7 a 15
 *   (ex.: `+5512912345678`, `12912345678`, `+14155552671`). Sem espacos, parenteses, pontos
 *   nem hifens: a formatacao para exibicao e responsabilidade de quem renderiza.
 * - FORMAS DE ENTRADA aceitas (importador e, por tolerancia, o proprio contrato): o mesmo texto
 *   com espacos, parenteses, pontos e hifens, com `+` ou `00` de prefixo internacional, p.ex.
 *   `(12) 91234-5678`, `+55 12 91234-5678`, `12 91234-5678`, `(415) 555-2671`, `+351 912 345 678`.
 * - Letras, ramais (`x123`), `+` fora do inicio, parenteses desbalanceados e quantidade de
 *   digitos fora de 7..15 sao invalidos. As mensagens NUNCA ecoam o valor recebido.
 */

export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

/** Forma canonica: `+` opcional + 7 a 15 digitos. */
export const PHONE_CANONICAL_REGEX = /^\+?[0-9]{7,15}$/;

/** Alfabeto e formato aceitos no texto de entrada (inclusive para o JSON Schema). */
export const PHONE_INPUT_REGEX = /^[+(0-9][0-9 ().+-]{4,38}[0-9]$/;

export const PHONE_INVALID_MESSAGE =
  'Telefone invalido: use apenas digitos (com + ou 00 e codigo do pais, quando houver), de 7 a 15 digitos; espacos, parenteses, pontos e hifens sao aceitos como separadores.';

export type PhoneNormalization = { ok: true; value: string } | { ok: false; reason: string };

/**
 * Converte um telefone em formato comum para a forma canonica. Pura e determinista; nunca lanca
 * e nunca inclui o valor recebido na `reason`.
 */
export function normalizePhone(input: string): PhoneNormalization {
  const raw = input.trim().replace(/[\u00A0\u2007\u202F\s]+/g, ' ');
  if (raw === '') return { ok: false, reason: 'Telefone vazio.' };
  if (!/^[0-9+()\s.\-\u2010-\u2015]+$/.test(raw)) {
    return {
      ok: false,
      reason: 'Telefone contem caracteres nao permitidos (apenas digitos e separadores).',
    };
  }

  // parenteses balanceados, sem aninhamento
  let depth = 0;
  for (const char of raw) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    if (depth < 0 || depth > 1)
      return { ok: false, reason: 'Parenteses do telefone desbalanceados.' };
  }
  if (depth !== 0) return { ok: false, reason: 'Parenteses do telefone desbalanceados.' };

  // `+` so e valido como prefixo (opcionalmente dentro de parenteses: "(+55) 12 ...").
  const plusCount = (raw.match(/\+/g) ?? []).length;
  const stripped = raw.replace(/^\(?\s*/, '');
  if (plusCount > 1 || (plusCount === 1 && !stripped.startsWith('+'))) {
    return { ok: false, reason: 'O sinal + so e aceito no inicio do telefone.' };
  }

  let digits = raw.replace(/\D/g, '');
  let international = plusCount === 1;
  if (!international && digits.startsWith('00')) {
    digits = digits.slice(2);
    international = true;
  }
  if (digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) {
    return {
      ok: false,
      reason: `Telefone deve ter de ${PHONE_MIN_DIGITS} a ${PHONE_MAX_DIGITS} digitos.`,
    };
  }
  return { ok: true, value: `${international ? '+' : ''}${digits}` };
}

/** `true` quando o texto ja esta na forma canonica. */
export const isCanonicalPhone = (value: string): boolean => PHONE_CANONICAL_REGEX.test(value);

/**
 * Telefone aceito pelo contrato: forma canonica OU qualquer forma de entrada normalizavel
 * (o contrato nao transforma o valor; a normalizacao e do importador).
 */
export const phoneSchema = z
  .string()
  .regex(PHONE_INPUT_REGEX, PHONE_INVALID_MESSAGE)
  .refine((value) => !PHONE_INPUT_REGEX.test(value) || normalizePhone(value).ok, {
    message: PHONE_INVALID_MESSAGE,
  });
