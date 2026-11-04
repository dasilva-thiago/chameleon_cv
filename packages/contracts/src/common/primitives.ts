import { z } from 'zod';
import { isValidPartialDate, PARTIAL_DATE_REGEX } from './dates';
import { fieldStateSchema } from './enums';

/**
 * Primitivas do contrato. Regras gerais:
 * - ausencia = campo omitido ou `null` (not_provided); `[]` = nenhum item fornecido;
 * - texto vazio ou so com espacos e REJEITADO pelo contrato (o importador normaliza "" para null);
 * - todo texto e todo array tem limite de tamanho (defesa contra payloads abusivos).
 */

export const LIMITS = {
  id: 64,
  shortText: 200,
  text: 2_000,
  longText: 10_000,
  url: 2_048,
  email: 254,
  shortList: 100,
  textList: 100,
  idList: 500,
  records: 500,
  subRecords: 200,
} as const;

const NOT_BLANK = /\S/;
const NOT_BLANK_MESSAGE =
  'Texto vazio nao e permitido: omita o campo ou use null quando o valor for desconhecido.';
const noNul = (value: string) => !value.includes('\u0000');

const textOf = (max: number) =>
  z
    .string()
    .max(max)
    .regex(NOT_BLANK, NOT_BLANK_MESSAGE)
    .refine(noNul, { message: 'Texto nao pode conter o caractere NUL.' });

/** Texto curto (nomes, titulos, rotulos): ate 200 caracteres. */
export const shortText = textOf(LIMITS.shortText);
/** Texto de tamanho medio (descricoes, resumos curtos): ate 2000 caracteres. */
export const text = textOf(LIMITS.text);
/** Texto longo (narrativas, notas): ate 10000 caracteres. */
export const longText = textOf(LIMITS.longText);

export const shortTextList = z.array(shortText).max(LIMITS.shortList);
export const textList = z.array(text).max(LIMITS.textList);

/** Identificador local livre (ex.: EXP-001) ou UUID. */
export const LOCAL_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
export const localIdSchema = z
  .string()
  .regex(
    LOCAL_ID_REGEX,
    'Id invalido: use letras, digitos, ".", "_", ":" ou "-" (ate 64 caracteres).',
  );
export const idList = z.array(localIdSchema).max(LIMITS.idList);

export const partialDateSchema = z
  .string()
  .regex(PARTIAL_DATE_REGEX, 'Data invalida: use AAAA, AAAA-MM ou AAAA-MM-DD.')
  .refine((value) => !PARTIAL_DATE_REGEX.test(value) || isValidPartialDate(value), {
    message: 'Data inexistente no calendario.',
  });

/** Fim de periodo: data parcial, ou "present" para "atual" (substitui o antigo `is_current`). */
export const periodEndSchema = z.union([partialDateSchema, z.literal('present')]);
export const PRESENT = 'present' as const;

/**
 * http(s) com host; sem espacos e sem credenciais (`usuario:senha@`) na autoridade.
 * Nao usamos `z.url()` sozinho porque ele normaliza (apara espacos) o valor; o contrato nao transforma dados.
 */
const HTTP_URL_SHAPE = /^https?:\/\/[^\s/?#@]+(?:[/?#]\S*)?$/i;
const urlParser = z.url({ protocol: /^https?$/ });
export const httpUrlSchema = z
  .string()
  .max(LIMITS.url)
  .regex(HTTP_URL_SHAPE, 'URL invalida: use http:// ou https://, sem espacos nem credenciais.')
  .refine((value) => !HTTP_URL_SHAPE.test(value) || urlParser.safeParse(value).success, {
    message: 'URL invalida.',
  });

export const emailSchema = z.email().max(LIMITS.email);

/** BCP-47 simplificado (ex.: pt-BR, en-US, es). */
export const localeSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/, 'Locale invalido: use BCP-47 (ex.: pt-BR).');

export const timezoneSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9_+\-/:]+$/, 'Fuso invalido: use um nome IANA (America/Sao_Paulo) ou UTC-3.');

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Moeda invalida: use o codigo ISO 4217 de 3 letras (ex.: BRL).');

export const nonNegativeNumber = z.number().min(0).max(1_000_000_000_000);

/**
 * Chave de campo em `field_states`: nome de campo do registro ou caminho aninhado dentro dele
 * (ex.: `end_date`, `metric.value`, `business.portfolio_url`; ate 3 niveis). A existencia do
 * campo no tipo de registro e validada pelo contrato (factories.ts), como em `target.field`.
 */
export const FIELD_NAME_REGEX = /^[a-z][a-z0-9_]{0,63}(?:\.[a-z][a-z0-9_]{0,63}){0,2}$/;
export const fieldNameSchema = z.string().max(200).regex(FIELD_NAME_REGEX);
export const fieldStatesSchema = z.record(fieldNameSchema, fieldStateSchema);
