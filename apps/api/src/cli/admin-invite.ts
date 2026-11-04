import { parseArgs } from 'node:util';
import type { Db } from '@chameleon/db';
import {
  DEFAULT_INVITE_TTL_HOURS,
  InviteError,
  createInvite,
  revokeOpenInvites,
} from '../auth/invites';

export const ADMIN_INVITE_USAGE = `Uso:
  pnpm --filter @chameleon/api admin:invite <email> [--expires-in-hours N] [--replace]
  pnpm --filter @chameleon/api admin:invite <email> --revoke

  <email>               e-mail convidado (o convite so serve para ele)
  --expires-in-hours N  validade (padrao ${DEFAULT_INVITE_TTL_HOURS}h)
  --replace             encerra um convite em aberto do mesmo e-mail e emite outro
  --revoke              revoga o convite em aberto do e-mail (nao cria outro)
`;

const OPTIONS = {
  'expires-in-hours': { type: 'string' },
  replace: { type: 'boolean' },
  revoke: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

const parse = (argv: readonly string[]) =>
  parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true });

export interface AdminInviteIo {
  db: Db;
  /** APP_ORIGIN, para montar o link de aceite. */
  appOrigin: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  now?: () => Date;
}

/** Caminho da tela de aceite na SPA (definido pela S1.3). O token vai no fragmento (#), nunca no log do servidor. */
export const ACCEPT_INVITE_PATH = '/accept-invite';

/**
 * CLI de convites. O token em claro e impresso UMA vez (stdout); so o SHA-256 vai ao banco.
 * Devolve o codigo de saida do processo.
 */
export async function runAdminInvite(argv: readonly string[], io: AdminInviteIo): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr(`Argumentos invalidos: ${error instanceof Error ? error.message : 'erro'}`);
    io.stderr(ADMIN_INVITE_USAGE);
    return 2;
  }
  const [email, ...extra] = parsed.positionals;
  if (!email || extra.length > 0 || parsed.values.help) {
    io.stderr(ADMIN_INVITE_USAGE);
    return parsed.values.help ? 0 : 2;
  }

  const now = io.now?.() ?? new Date();
  try {
    if (parsed.values.revoke) {
      const count = await revokeOpenInvites(io.db, email, now);
      io.stdout(count > 0 ? `Convites revogados: ${count}.` : 'Nenhum convite em aberto.');
      return 0;
    }
    const ttlHours =
      parsed.values['expires-in-hours'] === undefined
        ? DEFAULT_INVITE_TTL_HOURS
        : Number(parsed.values['expires-in-hours']);
    const created = await createInvite(io.db, {
      email,
      ttlHours,
      replace: parsed.values.replace === true,
      now,
    });
    const link = `${io.appOrigin}${ACCEPT_INVITE_PATH}#token=${created.token}`;
    io.stdout(`Convite criado para ${created.invite.email}`);
    io.stdout(`Expira em: ${created.invite.expiresAt.toISOString()}`);
    if (created.closedPrevious) io.stdout('Um convite anterior em aberto foi encerrado.');
    io.stdout('');
    io.stdout(`Token (mostrado UMA vez; so o hash fica guardado):\n${created.token}`);
    io.stdout('');
    io.stdout(`Link de aceite:\n${link}`);
    return 0;
  } catch (error) {
    if (error instanceof InviteError) {
      io.stderr(`Erro: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
