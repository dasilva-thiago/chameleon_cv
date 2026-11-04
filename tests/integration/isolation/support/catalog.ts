import type { TestDb } from './workspace';

/** Catalogo do PostgreSQL: a lista de tabelas/FKs vem do banco real, nunca escrita a mao. */
export interface ForeignKey {
  name: string;
  table: string;
  columns: string[];
  refTable: string;
  refColumns: string[];
  /** a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT. */
  onDelete: string;
}

export async function listForeignKeys(testDb: TestDb): Promise<ForeignKey[]> {
  const { rows } = await testDb.sql<ForeignKey>(`
    SELECT c.conname AS name,
           cl.relname AS "table",
           ft.relname AS "refTable",
           c.confdeltype AS "onDelete",
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS "refColumns"
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class ft ON ft.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE c.contype = 'f' AND n.nspname = 'public'
     ORDER BY cl.relname, c.conname`);
  return rows;
}

/** Tabelas do schema `public` (exceto o controle de migracoes do Prisma). */
export async function listTables(testDb: TestDb): Promise<string[]> {
  const { rows } = await testDb.sql<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

export async function listTablesWithColumn(testDb: TestDb, column: string): Promise<string[]> {
  const { rows } = await testDb.sql<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = $1 ORDER BY table_name`,
    [column],
  );
  return rows.map((row) => row.table_name);
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
}

export async function listColumns(testDb: TestDb, table: string): Promise<ColumnInfo[]> {
  const { rows } = await testDb.sql<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    udtName: row.udt_name,
    nullable: row.is_nullable === 'YES',
    hasDefault: row.column_default !== null,
  }));
}

/** Indices unicos (inclui os de @@unique do Prisma, que sao INDEX e nao CONSTRAINT) e PKs. */
export async function listUniqueKeys(
  testDb: TestDb,
): Promise<{ table: string; name: string; columns: string[] }[]> {
  const { rows } = await testDb.sql<{ table: string; name: string; columns: string[] }>(`
    SELECT cl.relname AS "table", ic.relname AS name,
           (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum) AS columns
      FROM pg_index i
      JOIN pg_class cl ON cl.oid = i.indrelid
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = cl.relnamespace
     WHERE i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL AND n.nspname = 'public'`);
  return rows;
}

export const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;
