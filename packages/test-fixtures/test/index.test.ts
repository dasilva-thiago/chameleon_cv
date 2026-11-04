import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index';

describe('@chameleon/test-fixtures', () => {
  it('expoe o nome do pacote (teste de fumaca)', () => {
    expect(PACKAGE_NAME).toBe('@chameleon/test-fixtures');
  });
});
