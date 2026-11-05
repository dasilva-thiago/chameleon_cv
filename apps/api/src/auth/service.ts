import { randomUUID } from 'node:crypto';
import {
  type AcceptInviteRequest,
  type AuthSessionResponse,
  type InvitePreviewResponse,
  SIGNUP_CONSENT_PURPOSE,
  type SignupConsentInput,
} from '@chameleon/contracts';
import type { Db, Session, User } from '@chameleon/db';
import type { Logger } from 'pino';
import { HttpError } from '../http/errors';
import { isRedeemable } from './invites';
import {
  PASSWORD_VIOLATION_MESSAGES,
  checkPasswordPolicy,
  getDummyHash,
  hashPassword,
  verifyPassword,
} from './passwords';
import type { SessionService } from './sessions';
import { hashToken } from './tokens';

const invalidCredentials = (): HttpError =>
  new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
const invalidInvite = (): HttpError =>
  new HttpError(400, 'INVITE_INVALID', 'Convite invalido ou expirado.');
const consentRequired = (): HttpError =>
  new HttpError(
    400,
    'CONSENT_REQUIRED',
    'O consentimento para o tratamento dos dados do perfil e necessario para criar a conta.',
  );
const consentInvalid = (): HttpError =>
  new HttpError(
    400,
    'CONSENT_INVALID',
    'Versao da politica desconhecida ou desatualizada. Recarregue a pagina e tente novamente.',
  );

export interface AuthServiceDeps {
  db: Db;
  sessions: SessionService;
  logger: Logger;
  now: () => Date;
  signupMode: 'invite' | 'open' | 'closed';
  /** Policy text versions the server accepts for `profile_processing` consent (config). */
  policyVersions: readonly string[];
}

export interface IssuedSession {
  token: string;
  response: AuthSessionResponse;
}

export function toSessionResponse(
  user: Pick<User, 'id' | 'email' | 'displayName'>,
  session: Pick<Session, 'expiresAt' | 'absoluteExpiresAt'>,
): AuthSessionResponse {
  return {
    user: { id: user.id, email: user.email, displayName: user.displayName },
    session: {
      expiresAt: session.expiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/** Casos de uso de autenticacao (login, convite, logout). Sem dependencia de Express. */
export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  /**
   * Login. E-mail inexistente, conta desativada, conta sem credencial e senha errada produzem a
   * MESMA resposta e o MESMO trabalho caro (uma verificacao argon2, com hash ficticio quando nao ha
   * credencial). Rotaciona: cria sessao nova e revoga a apresentada no cookie.
   */
  async login(input: {
    email: string;
    password: string;
    currentToken: string | undefined;
    userAgent: string | undefined;
    correlationId: string;
  }): Promise<IssuedSession> {
    const { db, sessions } = this.deps;
    const user = await db.global.user.findUnique({ where: { email: input.email } });
    // Same DB work on every path (user lookup + one scoped credential lookup): an unknown e-mail
    // queries a random owner id instead of skipping the query, so latency does not reveal whether
    // the account exists or is active.
    const credential = await db
      .forOwner(user?.id ?? randomUUID())
      .credential.findFirst({ where: { kind: 'password' } });
    const usable = user !== null && user.status === 'active' && user.deletedAt === null;
    const hash = usable && credential ? credential.passwordHash : await getDummyHash();
    const valid = await verifyPassword(hash, input.password);
    if (!usable || !credential || !valid) {
      this.deps.logger.warn({ event: 'auth.login.failed' }, 'login failed');
      throw invalidCredentials();
    }

    if (input.currentToken) await sessions.revokeByToken(input.currentToken);
    const { token, session } = await sessions.create(user.id, input.userAgent);
    await this.audit(user.id, 'auth.login', session.id, input.correlationId);
    this.deps.logger.info({ event: 'auth.login.success', ownerId: user.id }, 'login');
    return { token, response: toSessionResponse(user, session) };
  }

  /** Dados do convite para a tela de aceite. Resposta unica para invalido/expirado/usado/revogado. */
  async previewInvite(token: string): Promise<InvitePreviewResponse> {
    this.assertSignupOpen();
    const invite = await this.deps.db.global.invite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    const now = this.deps.now();
    if (!isRedeemable(invite, now)) {
      throw invalidInvite();
    }
    return { email: invite.email, expiresAt: invite.expiresAt.toISOString() };
  }

  /** Cria User + Credential (+ consentimentos) consumindo o convite numa unica transacao. */
  async acceptInvite(
    input: AcceptInviteRequest & { userAgent: string | undefined; correlationId: string },
  ): Promise<IssuedSession> {
    this.assertSignupOpen();
    const { db, sessions } = this.deps;
    const tokenHash = hashToken(input.token);
    const now = this.deps.now();

    // A politica de senha usa o e-mail do convite; esta consulta previa so le (nao consome).
    const preview = await db.global.invite.findUnique({ where: { tokenHash } });
    if (!isRedeemable(preview, now)) {
      throw invalidInvite();
    }
    const violation = checkPasswordPolicy(input.password, preview.email);
    if (violation) {
      throw new HttpError(400, 'WEAK_PASSWORD', PASSWORD_VIOLATION_MESSAGES[violation]);
    }
    const consent = this.assertProfileConsent(input.consents);
    const passwordHash = await hashPassword(input.password);

    const ownerId = randomUUID();
    let user: User;
    try {
      user = await db.forOwner(ownerId).$transaction(async (tx) => {
        // Consumo atomico: so um aceite concorrente vence.
        const claimed = await tx.invite.updateMany({
          where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
          data: { usedAt: now },
        });
        if (claimed.count !== 1) throw invalidInvite();
        const created = await tx.user.create({
          data: { id: ownerId, email: preview.email, displayName: input.displayName ?? null },
        });
        await tx.invite.update({ where: { tokenHash }, data: { usedByUserId: ownerId } });
        await tx.credential.create({
          data: { ownerId, kind: 'password', passwordHash },
        });
        // Server-side record of what was presented and accepted (validated above): the purpose and
        // granted flag are fixed by the server, only a known policy version is taken from the client.
        await tx.consentRecord.create({
          data: {
            ownerId,
            purpose: SIGNUP_CONSENT_PURPOSE,
            granted: true,
            policyVersion: consent.policyVersion,
            recordedAt: now,
          },
        });
        return created;
      });
    } catch (error) {
      // E-mail ja cadastrado (convite emitido apos a conta existir): mesma resposta generica.
      if (isUniqueViolation(error)) throw invalidInvite();
      throw error;
    }

    const { token, session } = await sessions.create(user.id, input.userAgent);
    await this.audit(user.id, 'auth.signup', session.id, input.correlationId);
    this.deps.logger.info({ event: 'auth.signup', ownerId: user.id }, 'account created');
    return { token, response: toSessionResponse(user, session) };
  }

  async logout(ownerId: string, sessionId: string, correlationId: string): Promise<number> {
    const revoked = await this.deps.sessions.revokeOne(ownerId, sessionId);
    await this.audit(ownerId, 'auth.logout', sessionId, correlationId);
    return revoked;
  }

  async logoutAll(ownerId: string, correlationId: string): Promise<number> {
    const revoked = await this.deps.sessions.revokeAll(ownerId);
    await this.audit(ownerId, 'auth.logout_all', null, correlationId, { revoked });
    return revoked;
  }

  /**
   * `profile_processing` must be granted, under a policy version the server publishes (LGPD:
   * consent is verified server-side, never inferred from the client's say-so). The DTO already
   * limits the purpose to `profile_processing`; re-checked here so a schema change cannot silently
   * open the door to purposes whose notice was not shown at this step.
   */
  private assertProfileConsent(consents: readonly SignupConsentInput[]): SignupConsentInput {
    const consent = consents.find((c) => c.purpose === SIGNUP_CONSENT_PURPOSE);
    if (consents.length !== 1 || !consent) throw consentInvalid();
    if (!consent.granted) throw consentRequired();
    if (!this.deps.policyVersions.includes(consent.policyVersion)) throw consentInvalid();
    return consent;
  }

  private assertSignupOpen(): void {
    if (this.deps.signupMode !== 'invite') {
      throw new HttpError(403, 'SIGNUP_CLOSED', 'Cadastro indisponivel.');
    }
  }

  /** Auditoria sem PII (ADR-0014). Falha de auditoria nunca derruba a operacao. */
  private async audit(
    ownerId: string,
    action: string,
    entityId: string | null,
    correlationId: string,
    metadata: Record<string, number | string | boolean> = {},
  ): Promise<void> {
    try {
      await this.deps.db.forOwner(ownerId).auditEvent.create({
        data: { ownerId, action, entityType: 'session', entityId, correlationId, metadata },
      });
    } catch {
      this.deps.logger.warn({ event: 'audit.write_failed', action }, 'audit write failed');
    }
  }
}
