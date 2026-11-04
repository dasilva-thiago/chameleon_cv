import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index';

describe('@chameleon/ai', () => {
  it('expoe o nome do pacote (teste de fumaca)', () => {
    expect(PACKAGE_NAME).toBe('@chameleon/ai');
  });
});
