import { tidy } from '@chameleon/domain';
import { z } from 'zod';

/**
 * Lenient readers for model answers. A model that gets one field wrong (an unknown enum value, a number written as
 * text, a missing list) should not cost the whole answer: each field falls back to a safe value, and the program's
 * own rules (`@chameleon/domain`) decide what the answer is worth afterwards.
 */

export const str = (max: number) =>
  z.unknown().transform((value) => (typeof value === 'string' ? tidy(value, max) : ''));

export const nullableStr = (max: number) =>
  z.unknown().transform((value) => {
    if (typeof value !== 'string') return null;
    const text = tidy(value, max);
    return text === '' || /^(null|n\/a|none|-)$/i.test(text) ? null : text;
  });

export const strList = (maxItems: number, maxLength: number) =>
  z.unknown().transform((value) =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => tidy(item, maxLength))
          .filter((item) => item !== '')
          .slice(0, maxItems)
      : [],
  );

export const oneOf = <const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
) =>
  z.unknown().transform((value): T[number] => {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return (values as readonly string[]).includes(text) ? text : fallback;
  });

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(
      value
        .replace(/[^\d.,-]/g, '')
        .replace(/\.(?=\d{3}(\D|$))/g, '')
        .replace(',', '.'),
    );
    return Number.isFinite(parsed) && value.trim() !== '' ? parsed : null;
  }
  return null;
};

export const num = (fallback: number) =>
  z.unknown().transform((value) => toNumber(value) ?? fallback);
export const nullableNum = () => z.unknown().transform((value) => toNumber(value));
export const bool = (fallback: boolean) =>
  z.unknown().transform((value) => (typeof value === 'boolean' ? value : fallback));

/** A list of objects: items that are not objects are skipped; each item is read with `item`. */
export const list = <S extends z.ZodType>(item: S, max: number) =>
  z.unknown().transform((value): z.output<S>[] => {
    if (!Array.isArray(value)) return [];
    const out: z.output<S>[] = [];
    for (const element of value) {
      if (typeof element !== 'object' || element === null) continue;
      const parsed = item.safeParse(element);
      if (parsed.success) out.push(parsed.data);
      if (out.length >= max) break;
    }
    return out;
  });

export const obj = <S extends z.ZodRawShape>(shape: S) => z.object(shape).loose();
