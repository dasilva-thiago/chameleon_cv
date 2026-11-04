import { Alert } from '../../components/ui/Alert';
import type { AuthNotice } from './session';

export function AuthNoticeBanner({ notice }: { notice: AuthNotice }) {
  switch (notice.kind) {
    case 'expired':
      return (
        <Alert tone="info" title="Sessão encerrada">
          Sua sessão expirou. Entre novamente para continuar.
        </Alert>
      );
    case 'signed-out':
      return <Alert tone="success">Você saiu da sua conta.</Alert>;
    case 'signed-out-all':
      return (
        <Alert tone="success">
          {notice.revokedSessions === 1
            ? 'Você saiu de todos os dispositivos (1 sessão encerrada).'
            : `Você saiu de todos os dispositivos (${String(notice.revokedSessions)} sessões encerradas).`}
        </Alert>
      );
  }
}
