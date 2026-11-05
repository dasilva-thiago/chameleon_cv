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
  CONSENT_REQUIRED: 'Para criar a conta é necessário autorizar o tratamento dos dados do perfil.',
  CONSENT_INVALID: 'O texto da política foi atualizado. Recarregue a página e tente novamente.',
  RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente novamente.',
  NOT_FOUND: 'O recurso solicitado não foi encontrado.',
  CONSENT_REQUIRED_FOR_PROFILE:
    'Sua conta ainda não tem a autorização para tratar os dados do perfil profissional. Fale com a pessoa que administra o serviço.',
  IMPORT_INVALID:
    'O arquivo não pôde ser importado. Confira se é um YAML ou JSON no formato do perfil e tente novamente.',
  IMPORT_PREVIEW_EXPIRED:
    'A prévia desta importação expirou. Envie o arquivo novamente para gerar uma nova prévia.',
  IMPORT_NOT_APPLICABLE:
    'Esta importação não pode mais ser aplicada, pois já foi aplicada ou descartada. Gere uma nova prévia.',
  ID_CONFLICT:
    'Alguns identificadores do arquivo já pertencem a outro perfil. Você pode importar gerando identificadores novos.',
  DUPLICATE_SKILL: 'Já existe uma competência equivalente a esta. Use a que já está cadastrada.',
  CONCURRENT_MODIFICATION:
    'O perfil foi alterado por outra ação ao mesmo tempo. Recarregue os dados e tente de novo.',
  RECORD_IN_USE:
    'Este item não pode ser excluído porque outros itens dependem dele. Remova o vínculo e tente de novo.',
  PROFILE_REQUIRED:
    'Cadastre ou importe o seu perfil profissional antes de analisar uma vaga ou gerar um currículo.',
  VERSION_APPROVED:
    'Esta versão já foi aprovada e não pode ser alterada. Crie uma nova versão para editar.',
  VERSION_NOT_APPROVED: 'Aprove a versão antes de exportar.',
  RESUME_INVALID:
    'O currículo tem itens sem fonte confirmada no perfil. Corrija os erros indicados antes de aprovar.',
  EXPORT_UNAVAILABLE:
    'Não foi possível gerar o arquivo agora. Para o PDF é preciso ter um navegador (Chromium, Chrome ou Edge) disponível no servidor.',
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
