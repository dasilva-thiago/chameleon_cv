/**
 * Texto do consentimento de tratamento dos dados do perfil. Ao alterar o conteudo, atualize
 * `DEFAULT_PROFILE_POLICY_VERSION` em `lib/config.ts`: a versao e gravada junto com a escolha.
 * Nao ha consentimento de IA nesta etapa.
 */
export const PROFILE_CONSENT_LABEL =
  'Autorizo o tratamento dos dados do meu perfil profissional neste serviço.';

export const PROFILE_CONSENT_PARAGRAPHS = [
  'Os dados do perfil que você cadastrar (por exemplo, experiências, formação, habilidades e documentos importados) serão armazenados e tratados somente para montar e adaptar os seus currículos. Eles pertencem à sua conta e não são visíveis a outros usuários.',
  'Marcar esta opção é opcional para criar a conta. Sua escolha é registrada junto com a versão do texto da política exibida abaixo.',
] as const;
