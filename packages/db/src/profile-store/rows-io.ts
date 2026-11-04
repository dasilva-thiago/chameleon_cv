import { Prisma } from '../generated/prisma/client';
import type { OwnerScopedClient } from '../client';
import type { Row } from '../mappers/codec';
import { CREATE_ORDER, DELETE_ORDER, type Plan } from '../mappers/plan';
import { JSON_COLUMNS, type DelegateName } from '../mappers/specs';
import { emptyTables, type DocumentRows } from '../mappers/to-rows';

/**
 * Leitura e escrita de linhas por delegate DINAMICO. Tudo passa pelo cliente escopado
 * (`forOwner`), que injeta/confere o `ownerId`; nao ha SQL cru aqui. O acesso por nome de tabela
 * existe para manter o mapeamento declarativo (specs) e testavel sem 20 copias de codigo.
 */

/** Cliente de transacao interativa do `forOwner` (tem os delegates; sem `$transaction`). */
export type Tx = OwnerScopedClient;

interface RowDelegate {
  findMany(args?: object): Promise<Row[]>;
  createMany(args: { data: Row[] }): Promise<unknown>;
  update(args: { where: object; data: Row }): Promise<unknown>;
  deleteMany(args: { where: object }): Promise<unknown>;
}

export const delegateOf = (tx: Tx, name: DelegateName): RowDelegate => {
  const delegate = (tx as unknown as Record<string, RowDelegate | undefined>)[name];
  if (!delegate) throw new Error(`Delegate Prisma inexistente: ${name}`);
  return delegate;
};

const byProfile = (profileId: string): object => ({ profileId });
const byFactProfile = (profileId: string): object => ({ fact: { profileId } });

/** Filtro por perfil de cada tabela (as tipadas filtram pelo ProfileFact). */
const READ_WHERE: Record<
  Exclude<DelegateName, 'professionalProfile'>,
  (profileId: string) => object
> = {
  profileFact: byProfile,
  profileStatement: byFactProfile,
  competencyExample: byFactProfile,
  competencyExampleSkill: (p) => ({ example: { fact: { profileId: p } } }),
  experience: byFactProfile,
  experienceItem: byFactProfile,
  project: byFactProfile,
  projectItem: byFactProfile,
  projectCollaborator: (p) => ({ project: { fact: { profileId: p } } }),
  education: byFactProfile,
  course: byFactProfile,
  skill: byProfile,
  skillUsage: byFactProfile,
  languageProficiency: byFactProfile,
  certification: byFactProfile,
  award: byFactProfile,
  publication: byFactProfile,
  volunteering: byFactProfile,
  contactPoint: byProfile,
  evidence: byProfile,
  evidenceLink: (p) => ({ evidence: { profileId: p } }),
  pendingItem: byProfile,
  usageRestriction: byProfile,
};

/** Le todas as linhas do perfil (use dentro de uma transacao para obter um retrato consistente). */
export async function readStoredRows(tx: Tx, profile: Row): Promise<DocumentRows> {
  const profileId = String(profile.id);
  const tables = emptyTables();
  for (const name of Object.keys(READ_WHERE) as Exclude<DelegateName, 'professionalProfile'>[]) {
    tables[name] = await delegateOf(tx, name).findMany({ where: READ_WHERE[name](profileId) });
  }
  return { profile, tables };
}

/** `null` em coluna Json precisa ser `Prisma.DbNull` na escrita. */
export function toWrite(delegate: DelegateName, row: Row): Row {
  const out: Row = { ...row };
  for (const column of JSON_COLUMNS[delegate]) {
    if (column in out && out[column] === null) out[column] = Prisma.DbNull;
  }
  return out;
}

const CHUNK = 500;

/** Executa o plano: criacoes (pais antes), atualizacoes e exclusoes (dependentes antes). */
export async function executePlan(tx: Tx, plan: Plan): Promise<void> {
  for (const name of CREATE_ORDER) {
    const rows = plan.creates[name];
    if (!rows || rows.length === 0) continue;
    const delegate = delegateOf(tx, name);
    for (let i = 0; i < rows.length; i += CHUNK) {
      await delegate.createMany({ data: rows.slice(i, i + CHUNK).map((r) => toWrite(name, r)) });
    }
  }
  for (const update of plan.updates) {
    await delegateOf(tx, update.delegate).update({
      where: { id: update.id },
      data: toWrite(update.delegate, update.data),
    });
  }
  for (const name of DELETE_ORDER) {
    const ids = plan.deletes[name];
    if (!ids || ids.length === 0) continue;
    const delegate = delegateOf(tx, name);
    for (let i = 0; i < ids.length; i += CHUNK) {
      await delegate.deleteMany({ where: { id: { in: ids.slice(i, i + CHUNK) } } });
    }
  }
}
