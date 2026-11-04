import { isApiError, type ApiErrorKind } from './errors';

/**
 * Mensagens exibidas ao usuario (pt-BR), escolhidas pelo codigo do erro. Nunca reutilizam o texto
 * enviado pelo servidor nem detalhes tecnicos, e mantem a resposta generica da API para
 * credenciais e convites (sem enumeracao de usuarios).
 */
const MESSAGES: Record<ApiErrorKind, string> = {
  VALIDATION_ERROR: 'Alguns dados informados são inválidos. Revise os campos e tente novamente.',
  INVALID_JSON: 'Não foi possível processar a solicitação. Tente novamente.',
  PAYLOAD_TOO_LARGE: 'Os dados enviados são grandes demais. Reduza o conteúdo e tente novamente.',
  UNSUPPORTED_MEDIA_TYPE: 'Não foi possível processar a solicitação. Tente novamente.',
  CSRF_ORIGIN:
    'Não foi possível validar a origem da solicitação. Recarregue a página e tente novamente.',
  CSRF_TOKEN: 'Sua verificação de segurança expirou. Recarregue a página e tente novamente.',
  UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente para continuar.',
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  INVITE_INVALID: 'Convite inválido ou expirado. Peça um novo convite a quem o enviou.',
  SIGNUP_CLOSED: 'O cadastro não está disponível no momento.',
  WEAK_PASSWORD:
    'Esta senha não é aceita. Escolha outra, evitando senhas comuns ou que contenham seu e-mail.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
  NOT_FOUND: 'O recurso solicitado não foi encontrado.',
  INTERNAL_ERROR: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
  NETWORK: 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.',
  TIMEOUT: 'O servidor demorou a responder. Tente novamente.',
  ABORTED: 'A solicitação foi cancelada.',
  UNEXPECTED_RESPONSE:
    'Recebemos uma resposta inesperada do servidor. Tente novamente em instantes.',
};

export const GENERIC_ERROR_MESSAGE = 'Ocorreu um erro inesperado. Tente novamente em instantes.';

function formatWait(seconds: number): string {
  if (seconds < 60) return 'menos de um minuto';
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'cerca de 1 minuto' : `cerca de ${String(minutes)} minutos`;
}

/** Texto seguro para o usuario. Inclui o codigo de suporte apenas em falhas do servidor. */
export function messageForError(error: unknown): string {
  if (!isApiError(error)) return GENERIC_ERROR_MESSAGE;
  let message = MESSAGES[error.code];
  if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds !== undefined) {
    message = `${message} Tente de novo em ${formatWait(error.retryAfterSeconds)}.`;
  }
  const supportCodeCodes: readonly ApiErrorKind[] = ['INTERNAL_ERROR', 'UNEXPECTED_RESPONSE'];
  if (error.requestId !== undefined && supportCodeCodes.includes(error.code)) {
    message = `${message} Código de suporte: ${error.requestId}.`;
  }
  return message;
}

/** Erros que a tela pode corrigir campo a campo (nomes de campo vindos de `details[].path`). */
export function fieldPathsOf(error: unknown): string[] {
  return isApiError(error) ? error.details.map((detail) => detail.path) : [];
}
