// Harness de banco para testes de integracao (ADR-0002). Importe de `@chameleon/db/testing`.
export { createTestDb, withTestDb } from './test-db';
export type { CreateTestDbOptions, TestDb } from './test-db';
export { ensureTemplateDatabase, migrationsHash, templateName } from './template';
export { assertLocalConnectionString, resolveAdminUrl } from './admin';
