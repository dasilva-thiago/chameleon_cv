/** Codigos de erro estaveis do ProfileStore (a API os traduz em respostas HTTP). */
export type ProfileStoreErrorCode =
  /** Id de registro que nao e UUID (rode o importador, que mapeia ids locais, antes de salvar). */
  | 'NON_UUID_ID'
  /** Perfil inexistente para o dono (inclui perfil de outro dono: sem oraculo de existencia). */
  | 'PROFILE_NOT_FOUND'
  | 'REVISION_NOT_FOUND'
  | 'IMPORT_NOT_FOUND'
  /** Importacao em estado que nao permite a operacao (ex.: aplicar duas vezes). */
  | 'IMPORT_NOT_APPLICABLE'
  /** Algum id do documento ja esta em uso (sem indicar de quem). Reenvie com `regenerateConflictingIds`. */
  | 'ID_CONFLICT'
  /** Violacao de serializacao/concorrencia: repita a operacao. */
  | 'CONCURRENT_MODIFICATION'
  /** Duas competencias do perfil com a mesma chave normalizada (ex.: "Node.js" e "node.js"). */
  | 'DUPLICATE_SKILL'
  /** Revisao armazenada nao confere com seu proprio hash. */
  | 'REVISION_CORRUPT'
  /** Campo do contrato sem lugar no banco (o contrato cresceu e o mapeamento nao): bug de programacao. */
  | 'UNMAPPED_FIELD';

export class ProfileStoreError extends Error {
  override readonly name = 'ProfileStoreError';
  constructor(
    readonly code: ProfileStoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}
