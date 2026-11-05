import { createHash, randomUUID } from 'node:crypto';
import {
  PRIVATE_MODELS,
  TEST_PASSWORD,
  buildProfileSnapshot,
  buildTestApp,
  createProfileStore,
  createTestAccount,
  createTestDb,
  createTwoAccounts,
  importProfile,
  listProfileCanaries,
  listProfileIds,
  loadProfileYaml,
  type ApiModule,
  type ProfileId,
  type ProfileStore,
  type TestAccount,
  type TestApp,
  type TestDb,
} from './workspace';

/** Fixture do dono A (muitos canarios em locais privados: 22) e do dono B (perfil nao-TI). */
export const FIXTURE_A: ProfileId = 'private-heavy';
export const FIXTURE_B: ProfileId = 'non-tech-nurse';

export interface Actor extends TestAccount {
  fixtureId: string;
  profileId: string;
  /** Importacao aplicada (com revisao) e uma previa pendente: alvos dos ataques cruzados. */
  appliedImportId: string;
  previewImportId: string;
  revisionId: string;
  /** Canarios da fixture deste dono (`CANARY-<slug>-<campo>`). */
  canaries: readonly string[];
}

/** O que identifica um dono para as varreduras (inclui os donos auxiliares, que nao tem canarios). */
export interface Identity {
  label: string;
  ownerId: string;
  email: string;
  canaries: readonly string[];
}

export interface World {
  testDb: TestDb;
  app: TestApp['app'];
  config: TestApp['config'];
  logs: TestApp['logs'];
  /** ProfileStore compoe o `buildProfileSnapshot` REAL do dominio (injecao feita pela API). */
  store: ProfileStore;
  a: Actor;
  b: Actor;
  /** Um dono por fixture restante (13 perfis no total): mais canarios e mais linhas por tabela. */
  others: Actor[];
  /** A, B e `others`: os donos de fixtures (todos com canarios). */
  all: Actor[];
  /** Dono de um perfil sintetico em que TODA FK e todo vinculo (certificacao, alvo de pendencia...) existe. */
  coverage: Actor;
  /** Dono com perfil vazio e SEM revisoes/importacoes (pai "limpo" para provar FKs cruzadas). */
  bare: Identity & { profileId: string };
  /** Todos os donos do mundo, para inventarios de vazamento. */
  everyone: Identity[];
  drop(): Promise<void>;
}

export interface WorldOptions {
  /** Modulos extras montados no app (ex.: rotas sinteticas de recurso para autotestes). */
  modules?: readonly ApiModule[];
}

/**
 * Perfil sintetico 100% ficticio que preenche as ligacoes que as fixtures de perfil nao usam
 * (certificacao de idioma, alvos de pendencia/restricao em contato e evidencia), para que a suite de
 * FK composta exercite TODA FK do catalogo com dados reais.
 */
export const COVERAGE_PROFILE = {
  schema_version: '2.1.0',
  profile: {
    contact_points: [
      {
        id: 'CP-1',
        kind: 'email',
        value: 'cobertura@example.invalid',
        visibility: 'private',
        include_by_default: false,
      },
    ],
    certifications: [
      { id: 'CRT-1', name: 'Certificado de proficiencia ficticio', issuer: 'Entidade ficticia' },
    ],
    languages: [
      {
        id: 'LNG-1',
        language: 'Ingles',
        language_code: 'en',
        overall_level: 'B1',
        certification_id: 'CRT-1',
      },
    ],
    evidence: [
      { id: 'EVD-1', type: 'document', title: 'Comprovante ficticio', supports: ['CRT-1'] },
    ],
    pending_items: [
      {
        id: 'PEND-1',
        target: { record_id: 'CP-1', field: 'value' },
        subject: 'Confirmar o contato',
        reason: 'missing',
        status: 'open',
      },
      {
        id: 'PEND-2',
        target: { record_id: 'EVD-1' },
        subject: 'Confirmar a evidencia',
        reason: 'missing',
        status: 'open',
      },
    ],
    usage_rules: {
      restrictions: [
        { target: { record_id: 'CP-1' }, rule: 'never_include', reason: 'Contato reservado.' },
        { target: { record_id: 'EVD-1' }, rule: 'never_include', reason: 'Evidencia reservada.' },
      ],
    },
  },
} as const;

async function provisionActor(
  store: ProfileStore,
  account: TestAccount,
  fixtureId: string,
  input: string | Record<string, unknown>,
  canaries: readonly string[],
): Promise<Actor> {
  // Caminho REAL de importacao: texto/objeto -> profile-io (migra/normaliza/valida/defaults/ids) -> store.
  const imported = importProfile(input);
  if (!imported.ok || !imported.document) {
    throw new Error(`fixture ${fixtureId} nao importou: ${JSON.stringify(imported.report.errors)}`);
  }
  const applied = await store.applyImport(account.ownerId, {
    document: imported.document,
    report: imported.report,
    mode: 'merge',
  });
  const preview = await store.createImportRecord(account.ownerId, { report: imported.report });
  return {
    ...account,
    fixtureId,
    profileId: applied.save.profileId,
    appliedImportId: applied.importRecord.id,
    previewImportId: preview.id,
    revisionId: applied.revision.revision.id,
    canaries,
  };
}

/**
 * Par de contas DESCARTAVEL (A' com a fixture de A, B' com a de B), com senhas DISTINTAS, para os
 * casos que destroem sessoes (logout, revogacao, usuario desativado) sem estragar A/B do mundo.
 * Mesmos canarios de A/B (mesma fixture), por isso nao entram em `world.everyone`.
 */
export async function createPair(world: World, label: string): Promise<{ a: Actor; b: Actor }> {
  const ctx = { app: world.app, config: world.config, db: world.testDb.db };
  const accountA = await createTestAccount(ctx, {
    email: `${label}-a@example.test`,
    password: `senha-correta-de-A-${label}-91827`,
  });
  const accountB = await createTestAccount(ctx, {
    email: `${label}-b@example.test`,
    password: `senha-correta-de-B-${label}-73645`,
  });
  const fixture = (id: ProfileId) => [id, loadProfileYaml(id), listProfileCanaries(id)] as const;
  return {
    a: await provisionActor(world.store, accountA, ...fixture(FIXTURE_A)),
    b: await provisionActor(world.store, accountB, ...fixture(FIXTURE_B)),
  };
}

const identityOf = (actor: Actor): Identity => ({
  label: actor.fixtureId,
  ownerId: actor.ownerId,
  email: actor.email,
  canaries: actor.canaries,
});

/**
 * Mundo da suite: banco clonado, app completo (com LogCapture), 13 donos (um por fixture de perfil),
 * cada um com perfil importado, revisao e importacao em previa; A e B sao as contas "de interesse"
 * criadas por `createTwoAccounts` (fluxo real convite -> aceite). Mais um dono sintetico de cobertura
 * de FK e um dono com perfil vazio.
 */
export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const testDb = await createTestDb();
  const { app, config, logs } = buildTestApp(
    testDb.db,
    options.modules ? { modules: options.modules } : {},
  );
  const store = createProfileStore(testDb.db, { snapshot: buildProfileSnapshot });
  const ctx = { app, config, db: testDb.db };

  const { a: accountA, b: accountB } = await createTwoAccounts(ctx);
  const fixture = (id: ProfileId) => [id, loadProfileYaml(id), listProfileCanaries(id)] as const;
  const a = await provisionActor(store, accountA, ...fixture(FIXTURE_A));
  const b = await provisionActor(store, accountB, ...fixture(FIXTURE_B));

  const others: Actor[] = [];
  let index = 0;
  for (const fixtureId of listProfileIds()) {
    if (fixtureId === FIXTURE_A || fixtureId === FIXTURE_B) continue;
    index += 1;
    const account = await createTestAccount(ctx, {
      email: `dono-${String(index).padStart(2, '0')}@example.test`,
      displayName: `Dono ${index}`,
    });
    others.push(await provisionActor(store, account, ...fixture(fixtureId)));
  }

  const coverageAccount = await createTestAccount(ctx, { email: 'cobertura@example.test' });
  const coverage = await provisionActor(
    store,
    coverageAccount,
    'fk-coverage',
    structuredClone(COVERAGE_PROFILE),
    [],
  );

  const bareAccount = await createTestAccount(ctx, { email: 'vazio@example.test' });
  const bareSaved = await store.saveProfileDocument(bareAccount.ownerId, {
    schema_version: '2.1.0',
    profile: {},
  });

  // Consentimentos e auditoria do dono A (modelos privados fora do agregado de perfil).
  const scopedA = testDb.db.forOwner(a.ownerId);
  await scopedA.consentRecord.create({
    data: {
      ownerId: a.ownerId,
      purpose: 'profile_processing',
      granted: true,
      policyVersion: 'policy-2026-11',
    },
  });
  await scopedA.auditEvent.create({
    data: {
      ownerId: a.ownerId,
      action: 'profile.import',
      entityType: 'ImportRecord',
      entityId: a.appliedImportId,
      correlationId: randomUUID(),
      metadata: { note: 'sem PII' },
    },
  });

  // Uma vaga salva por dono (modelo privado fora do agregado de perfil).
  for (const actor of [a, b, ...others]) {
    const description = `Vaga do mundo de teste ${actor.fixtureId}`;
    const descriptionHash = createHash('sha256').update(description).digest('hex');
    const job = await testDb.db.forOwner(actor.ownerId).jobPosting.create({
      data: {
        ownerId: actor.ownerId,
        description,
        descriptionHash,
        company: `Empresa ${actor.fixtureId}`,
      },
    });
    await testDb.db.forOwner(actor.ownerId).jobAnalysis.create({
      data: {
        ownerId: actor.ownerId,
        jobId: job.id,
        descriptionHash,
        profileHash: createHash('sha256').update(`perfil ${actor.fixtureId}`).digest('hex'),
        engine: 'deterministic',
        engineVersion: 'test-1',
        result: { nota: `Analise do mundo de teste ${actor.fixtureId}` },
        review: {},
      },
    });
  }

  const all = [a, b, ...others];
  const bare = {
    label: 'bare',
    ownerId: bareAccount.ownerId,
    email: bareAccount.email,
    canaries: [] as string[],
    profileId: bareSaved.profileId,
  };
  return {
    testDb,
    app,
    config,
    logs,
    store,
    a,
    b,
    others,
    all,
    coverage,
    bare,
    everyone: [...all.map(identityOf), identityOf(coverage), bare],
    drop: () => testDb.drop(),
  };
}

// ---------------------------------------------------------------------------
// Inventario de "coisas que so o dono pode ver"
// ---------------------------------------------------------------------------

const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);
export const delegateName = (model: string): string => lowerFirst(model);

/** Todos os ids (UUID) das linhas privadas de um dono, por SQL cru: sao identificadores que nao podem vazar. */
export async function privateRowIds(world: World, ownerId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const model of PRIVATE_MODELS) {
    const { rows } = await world.testDb.sql<{ id: string }>(
      `SELECT "id"::text AS id FROM "${model}" WHERE "ownerId" = $1`,
      [ownerId],
    );
    for (const row of rows) ids.add(row.id);
  }
  return [...ids];
}

export { TEST_PASSWORD };
