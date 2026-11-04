import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PACKAGE_NAME } from '../src/index';

describe('@chameleon/contracts', () => {
  it('expoe o nome do pacote (teste de fumaca)', () => {
    expect(PACKAGE_NAME).toBe('@chameleon/contracts');
  });

  it('Zod 4 esta disponivel e gera JSON Schema nativo', () => {
    const schema = z.object({ name: z.string().nullable() }).strict();
    expect(schema.safeParse({ name: null }).success).toBe(true);
    expect(schema.safeParse({ unknown: 1 }).success).toBe(false);
    expect(z.toJSONSchema(schema)).toMatchObject({ type: 'object' });
  });
});
