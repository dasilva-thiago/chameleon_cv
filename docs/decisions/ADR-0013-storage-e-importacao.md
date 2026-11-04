# ADR-0013 — Armazenamento de arquivos e formatos de importação

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
- O plano §12 pede para não guardar arquivos gerados como blob no PostgreSQL no MVP, e o §17 pede sanitização, bloqueio de path traversal e autorização em downloads.
- O Adendo §3.2 e o plano §5 colocam a importação de DOCX/PDF como extração preliminar, posterior ao MVP.

## Decisão

**Storage**
- Interface `StorageProvider { put, getStream, delete, deletePrefix }`. A implementação do MVP é `LocalStorageProvider`, em `STORAGE_ROOT` (padrão `.data/storage`, gitignored, fora de qualquer diretório servido).
- Chave opaca `<ownerId>/<purpose>/<uuidv7>`. **Nunca** se usa o nome enviado pelo usuário no caminho. O caminho resolvido é verificado com `path.relative`, deve ficar dentro da raiz, e links simbólicos são rejeitados.
- Os metadados (`UploadedFile`, `DocumentExport`) ficam no banco com `sha256` e tamanho.
- O download passa por uma rota autenticada, com verificação de dono via `forOwner` e `Content-Disposition` com nome sanitizado (RFC 6266). Há também `X-Content-Type-Options: nosniff`.
- Validação na entrada:
  - limite de tamanho (`UPLOAD_MAX_BYTES`, padrão 2 MB para importação de perfil e 10 MB para evidência);
  - MIME detectado por assinatura (`file-type`) e lista permitida por finalidade;
  - texto em UTF-8 válido.
- Não há antivírus no MVP (limitação registrada). Os arquivos nunca são executados nem renderizados como HTML.
- A exclusão de conta chama `deletePrefix(ownerId/)`, com verificação pós-exclusão.
- Futuro: `S3CompatibleStorageProvider`, com a mesma interface.

**Importação (ordem de entrega)**

| Fase | Formato |
|---|---|
| 2 (MVP) | **YAML e JSON** no contrato v2 ou 1.0.0 (com migração), via upload ou colar texto. Pré-visualização obrigatória: contagem por seção, avisos, `unmapped`, mapa de ids e diff com o perfil atual. Aplicação explícita em transação, com criação de `ProfileRevision` e `ImportRecord` |
| 2b | **Markdown do template v2 anotado** (`<!-- path: ... -->`), por parser determinístico das âncoras. Markdown livre não é suportado: o resultado diz o que não foi reconhecido |
| 7 (pós-MVP) | **DOCX/PDF de currículo antigo**: extração de texto (`mammoth`/`unpdf`) → IA estruturada com `source_excerpt` por item → todos os itens com `source = resume_import`, `status = needs_review` e pré-visualização obrigatória. Nunca vira verdade automática |

- **Modos de aplicação:**
  - `merge` (padrão): adiciona registros novos; registros com o mesmo id são atualizados apenas com confirmação por item;
  - `replace`: cria uma nova revisão; nada é apagado sem confirmação.
- **Exportação de perfil:** YAML e JSON v2 com ids UUID. Uma reimportação idempotente não duplica registros.
- **Perfil-piloto:** conversão única, feita manualmente e com apoio de agente, de `BASE_DE_DADOS_CURRICULO_THIAGO.md` (prosa) para `fixtures-private/pilot.profile.v2.yaml` (gitignored). Não é importação de produto.

## Alternativas
- **Blobs no PostgreSQL:** desaconselhados pelo plano para o MVP; aumentam o banco e o backup.
- **Importar DOCX/PDF já no MVP:** maior risco de fatos errados e fora do escopo do MVP.

## Verificação
Testes:
- upload acima do limite → 413;
- MIME falso → 415;
- nome com `../` não afeta o caminho;
- download de outro dono → 404;
- reimportação idempotente;
- importação 1.0.0 com avisos;
- pré-visualização não persiste nada.
