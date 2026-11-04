import type { Db, Invite } from '@chameleon/db';
import { authEmailSchema } from '@chameleon/contracts';
import { generateToken, hashToken } from './tokens';

export const DEFAULT_INVITE_TTL_HOURS = 72;
export const MAX_INVITE_TTL_HOURS = 24 * 30;

export type InviteErrorCode =
  'INVALID_EMAIL' | 'USER_EXISTS' | 'OPEN_INVITE_EXISTS' | 'INVALID_TTL';

/** Erro de regra de negocio do convite (usado pela CLI; a API responde de forma generica). */
export class InviteError extends Error {
  readonly code: InviteErrorCode;
  constructor(code: InviteErrorCode, message: string) {
    super(message);
    this.name = 'InviteError';
    this.code = code;
  }
}

export interface CreatedInvite {
  /** Token em claro: devolvido UMA vez; so o SHA-256 e persistido. */
  token: string;
  invite: Invite;
  /** Convite anterior (expirado ou substituido) que foi encerrado. */
  closedPrevious: boolean;
}

/** Convite que ainda pode ser aceito: existe, nao usado/revogado e nao expirado. */
export function isRedeemable(invite: Invite | null, now: Date): invite is Invite {
  return invite !== null && invite.usedAt === null && invite.expiresAt.getTime() > now.getTime();
}

export function normalizeInviteEmail(email: string): string {
  const parsed = authEmailSchema.safeParse(email);
  if (!parsed.success) throw new InviteError('INVALID_EMAIL', 'E-mail invalido.');
  return parsed.data;
}

/**
 * Convite "revogado" = `usedAt` preenchido SEM `usedByUserId` (o schema nao tem coluna propria e o
 * indice parcial `Invite_email_open_key` so admite um convite em aberto por e-mail).
 */
export async function revokeOpenInvites(db: Db, email: string, now: Date): Promise<number> {
  const result = await db.global.invite.updateMany({
    where: { email: normalizeInviteEmail(email), usedAt: null },
    data: { usedAt: now },
  });
  return result.count;
}

export async function createInvite(
  db: Db,
  options: { email: string; ttlHours?: number; replace?: boolean; now?: Date },
): Promise<CreatedInvite> {
  const email = normalizeInviteEmail(options.email);
  const ttlHours = options.ttlHours ?? DEFAULT_INVITE_TTL_HOURS;
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > MAX_INVITE_TTL_HOURS) {
    throw new InviteError(
      'INVALID_TTL',
      `Validade deve estar entre 1 e ${MAX_INVITE_TTL_HOURS} horas.`,
    );
  }
  const now = options.now ?? new Date();
  const token = generateToken();

  return db.global.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new InviteError('USER_EXISTS', 'Ja existe uma conta com este e-mail.');
    }
    const open = await tx.invite.findFirst({ where: { email, usedAt: null } });
    let closedPrevious = false;
    if (open) {
      const stillValid = open.expiresAt.getTime() > now.getTime();
      if (stillValid && !options.replace) {
        throw new InviteError(
          'OPEN_INVITE_EXISTS',
          'Ja existe um convite em aberto para este e-mail (use --replace para substitui-lo).',
        );
      }
      await tx.invite.update({ where: { id: open.id }, data: { usedAt: now } });
      closedPrevious = true;
    }
    const invite = await tx.invite.create({
      data: {
        email,
        tokenHash: hashToken(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + ttlHours * 3_600_000),
      },
    });
    return { token, invite, closedPrevious };
  });
}
