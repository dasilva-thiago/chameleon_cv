/**
 * Utilitarios de teste das fixtures (nao exportados pelo pacote).
 * Trabalham sobre o YAML parseado como dados genericos, sem depender do contrato v2.
 */
import { loadProfile, type ProfileId } from '../src/index';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Rec = Record<string, unknown>;
export type PathPart = string | number;

export function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface WalkEntry {
  readonly value: unknown;
  readonly path: readonly PathPart[];
  /** Ancestrais, do mais externo ao pai imediato (nao inclui `value`). */
  readonly ancestors: readonly unknown[];
}

/** Percorre toda a arvore (objetos, listas e escalares). */
export function walk(root: unknown, visit: (entry: WalkEntry) => void): void {
  const go = (value: unknown, path: PathPart[], ancestors: unknown[]): void => {
    visit({ value, path, ancestors });
    if (Array.isArray(value)) {
      value.forEach((item, i) => go(item, [...path, i], [...ancestors, value]));
    } else if (isRec(value)) {
      for (const [k, v] of Object.entries(value)) go(v, [...path, k], [...ancestors, value]);
    }
  };
  go(root, [], []);
}

export function profileOf(id: ProfileId): Rec {
  const doc = loadProfile(id);
  const profile = doc.profile;
  if (!isRec(profile)) throw new Error(`${id}: profile ausente`);
  return profile;
}

export function listOf(profile: Rec, key: string): Rec[] {
  const value = profile[key];
  return Array.isArray(value) ? value.filter(isRec) : [];
}

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function metaOf(record: Rec): Rec {
  return isRec(record.meta) ? record.meta : {};
}

/** Todo objeto com `id` string dentro do documento, com seu caminho. */
export function collectIds(root: unknown): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  walk(root, ({ value, path }) => {
    if (isRec(value) && typeof value.id === 'string') {
      out.push({ id: value.id, path: path.join('.') });
    }
  });
  return out;
}

export type SkillUsageSourceKey =
  | 'experience_id'
  | 'project_id'
  | 'education_id'
  | 'course_id'
  | 'certification_id'
  | 'volunteering_id';

export const SOURCE_COLLECTION: Record<SkillUsageSourceKey, string> = {
  experience_id: 'experiences',
  project_id: 'projects',
  education_id: 'education',
  course_id: 'courses',
  certification_id: 'certifications',
  volunteering_id: 'volunteering',
};

export function usagesOf(profile: Rec): Rec[] {
  return listOf(profile, 'skill_usages');
}

export function usageContexts(profile: Rec): Set<string> {
  const out = new Set<string>();
  for (const usage of usagesOf(profile)) {
    const ctx = str(usage.usage_context);
    if (ctx) out.add(ctx);
  }
  return out;
}

export function skillName(profile: Rec, skillId: unknown): string | null {
  const skill = listOf(profile, 'skills').find((s) => s.id === skillId);
  return skill ? str(skill.name) : null;
}

export function fieldStatesOf(profile: Rec): Set<string> {
  const out = new Set<string>();
  walk(profile, ({ value, path }) => {
    if (path[path.length - 1] === 'field_states' && isRec(value)) {
      for (const state of Object.values(value)) if (typeof state === 'string') out.add(state);
    }
  });
  return out;
}
