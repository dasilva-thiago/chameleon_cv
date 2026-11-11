import { expect } from 'vitest';
import { BASE_CV, BASE_PROFILE } from './scripted-provider';
import type { TestClient } from './test-client';

export {
  BASE_CV,
  BASE_PROFILE,
  JOB_TEXT,
  scriptedProvider,
  type Scripted,
} from './scripted-provider';

/** Saves the synthetic base for an account. */
export async function seedBase(
  client: TestClient,
  cv = BASE_CV,
  profile = BASE_PROFILE,
): Promise<void> {
  const response = await client.put('/api/profile', { cvMarkdown: cv, profileMarkdown: profile });
  expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
}
