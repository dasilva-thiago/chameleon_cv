import type { Express } from 'express';
import { expect } from 'vitest';
import { getRouteManifest } from '../../src/http';
import type { AppConfig } from '../../src/config';
import { TestClient } from './test-client';

const SAMPLE_ID = '00000000-0000-4000-8000-000000000000';

/**
 * Generic gate check: EVERY route the manifest classifies as `session` answers 401 UNAUTHENTICATED
 * to a client with no cookie (CSRF material is sent, so the 401 comes from the auth guard and not
 * from CSRF). Returns the checked routes so callers can assert the sweep was not empty.
 */
export async function expectSessionRoutesRejectAnonymous(
  app: Express,
  config: Pick<AppConfig, 'APP_ORIGIN'>,
): Promise<string[]> {
  const sessionRoutes = getRouteManifest(app).filter((route) => route.auth === 'session');
  const client = new TestClient(app, config);
  const checked: string[] = [];
  for (const route of sessionRoutes) {
    const path = route.path.replace(/:[A-Za-z0-9_]+/g, SAMPLE_ID);
    const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    const response = await client.request(method, path, route.mutating ? {} : undefined);
    const label = `${route.method} ${route.path}`;
    expect(response.status, label).toBe(401);
    expect((response.body as { error: { code: string } }).error.code, label).toBe(
      'UNAUTHENTICATED',
    );
    checked.push(label);
  }
  return checked;
}
