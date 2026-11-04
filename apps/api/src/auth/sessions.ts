import type { Db, Session, User } from '@chameleon/db';
import { TOKEN_REGEX, generateToken, hashToken } from './tokens';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** ADR-0009: expiracao deslizante de 7 dias e absoluta de 30 dias. */
export interface SessionPolicy {
  idleMs: number;
  absoluteMs: number;
  /** Intervalo minimo entre renovacoes (evita um UPDATE por requisicao). */
  touchIntervalMs: number;
  /** Sessoes ativas por usuario; as mais antigas alem do limite sao revogadas no login. */
  maxActive: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleMs: 7 * DAY,
  absoluteMs: 30 * DAY,
  touchIntervalMs: MINUTE,
  maxActive: 10,
};

export interface ResolvedSession {
  session: Session;
  user: User;
}

/** Remove caracteres de controle (inclui NUL, que o PostgreSQL rejeita) e trunca. */
export function sanitizeUserAgent(value: string | undefined): string | null {
  if (!value) return null;
  // eslint-disable-next-line no-control-regex -- remover controles (inclui NUL) e o objetivo
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  return cleaned === '' ? null : cleaned;
}

/**
 * Sessoes no servidor. Unico lugar (junto de `AuthService`) que usa `db.unsafeRaw`: o lookup por
 * `tokenHash` acontece ANTES de se conhecer o dono (ADR-0008, item 2; db/README "escape hatch").
 * Toda escrita posterior e feita por `db.forOwner(ownerId)`.
 */
export class SessionService {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
    private readonly policy: SessionPolicy = DEFAULT_SESSION_POLICY,
  ) {}

  async create(
    ownerId: string,
    userAgent: string | undefined,
  ): Promise<{ token: string; session: Session }> {
    const token = generateToken();
    const now = this.now();
    const absoluteExpiresAt = new Date(now.getTime() + this.policy.absoluteMs);
    const expiresAt = new Date(
      Math.min(now.getTime() + this.policy.idleMs, absoluteExpiresAt.getTime()),
    );
    const scoped = this.db.forOwner(ownerId);
    const session = await scoped.session.create({
      data: {
        ownerId,
        tokenHash: hashToken(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
        absoluteExpiresAt,
        userAgent: sanitizeUserAgent(userAgent),
      },
    });
    await this.enforceActiveLimit(ownerId, now);
    return { token, session };
  }

  private async enforceActiveLimit(ownerId: string, now: Date): Promise<void> {
    const scoped = this.db.forOwner(ownerId);
    const excess = await scoped.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: now }, absoluteExpiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      skip: this.policy.maxActive,
      select: { id: true },
    });
    if (excess.length > 0) {
      await scoped.session.updateMany({
        where: { id: { in: excess.map((row) => row.id) } },
        data: { revokedAt: now },
      });
    }
  }

  /** Valida o token do cookie; renova a expiracao deslizante. `null` = sem sessao valida. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!TOKEN_REGEX.test(token)) return null;
    const found = await this.db.unsafeRaw.session.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!found) return null;
    const now = this.now();
    if (
      found.revokedAt !== null ||
      found.expiresAt.getTime() <= now.getTime() ||
      found.absoluteExpiresAt.getTime() <= now.getTime()
    ) {
      return null;
    }
    const user = await this.db.global.user.findUnique({ where: { id: found.ownerId } });
    if (user?.status !== 'active' || user.deletedAt !== null) return null;

    let session = found;
    if (now.getTime() - found.lastSeenAt.getTime() >= this.policy.touchIntervalMs) {
      const expiresAt = new Date(
        Math.min(now.getTime() + this.policy.idleMs, found.absoluteExpiresAt.getTime()),
      );
      session = await this.db
        .forOwner(found.ownerId)
        .session.update({ where: { id: found.id }, data: { lastSeenAt: now, expiresAt } });
    }
    return { session, user };
  }

  /** Revoga a sessao do token (rotacao no login). Silencioso se o token for desconhecido. */
  async revokeByToken(token: string): Promise<void> {
    if (!TOKEN_REGEX.test(token)) return;
    await this.db.unsafeRaw.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: this.now() },
    });
  }

  async revokeOne(ownerId: string, sessionId: string): Promise<number> {
    const result = await this.db.forOwner(ownerId).session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.now() },
    });
    return result.count;
  }

  async revokeAll(ownerId: string): Promise<number> {
    const result = await this.db
      .forOwner(ownerId)
      .session.updateMany({ where: { revokedAt: null }, data: { revokedAt: this.now() } });
    return result.count;
  }
}
