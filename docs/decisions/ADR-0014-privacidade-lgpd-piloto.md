# ADR-0014 — Privacidade, LGPD e tratamento dos dados do perfil-piloto

**Status:** Aceita (não implementada). Os prazos de retenção e os textos legais são **propostas** que dependem do usuário.
**Data:** 2026-11-04

## Contexto
- O Adendo §7 e o plano §17 pedem: minimização; preferências privadas fora dos prompts; ver, corrigir, exportar e excluir; retenção; consentimento e finalidade; logs sem conteúdo.
- O pacote contém dados pessoais reais (telefone e e-mail) em `BASE_DE_DADOS_CURRICULO_THIAGO.md` (l. 71–72) **e** no Anexo A do plano V3 (l. 1751–1752). O README do pacote alerta para não publicar esse conteúdo.

## Decisão

**Minimização**
- O contrato v2 não tem campos de documentos (CPF/RG/passaporte), endereço residencial, dados de saúde, religião ou política.
- O validador V10 e um aviso na importação detectam padrões de documento e endereço em texto livre e sugerem remover.
- Preferências, disponibilidade, salário, motivo de saída, pronomes e notas são privados por construção e nunca vão à IA nem ao documento. Exceção: salário, com autorização por geração.

**Consentimento** (`ConsentRecord`, registrado na UI com a versão da política):
- `profile_processing` é obrigatório para usar o produto;
- `ai_processing:<provider>` é obrigatório antes da primeira chamada a um provedor real, com aviso de transferência internacional (LGPD art. 33) e de quais dados são enviados;
- o `processing_consent` vindo de um arquivo importado **não** conta como consentimento.

**Direitos do titular**
- Ver e corrigir: o editor de perfil.
- **Exportar tudo:** `GET /api/account/export` gera um zip com o perfil v2, as revisões, vagas, análises, currículos, metadados de execução e arquivos.
- **Excluir conta:** transação com `allow_purge` e cascata por `ownerId`, depois `storage.deletePrefix`, revogação de sessões e registro mínimo da exclusão (sem PII). Prazo: imediato, com confirmação por senha.
- Exclusões granulares: vaga, currículo, versão, arquivo.

**Retenção proposta** (configurável por variável de ambiente; **confirmar com o usuário**):

| Dado | Prazo |
|---|---|
| Arquivos de importação | apagados 7 dias após aplicação ou descarte |
| Logs da aplicação | 30 dias, sem conteúdo pessoal |
| `GenerationRun` (metadados) | 180 dias |
| Sessões | 30 dias |
| Vagas, currículos e exportações | até exclusão pelo usuário |
| Captura de depuração da IA | desligada; se ligada, 24 h |

Um job diário de limpeza é instalado na Fase 7.

**Logs:** redaction no pino e teste de canário (ADR-0008 e ADR-0010).

**Perfil-piloto**
- Os arquivos com PII real não devem ir para um repositório público.
- Antes do primeiro commit, o `.gitignore` deve listar `BASE_DE_DADOS_CURRICULO_THIAGO.md` e `fixtures-private/`.
- O plano V3 contém os mesmos dados no Anexo A. O usuário decide entre (a) redigir as linhas de contato do Anexo A, (b) manter o repositório privado ou (c) mover o Anexo A para um arquivo ignorado.
- O fixture convertido fica em `fixtures-private/pilot.profile.v2.yaml`.
- Testes que dependem do piloto são marcados `skipIf(!exists)`.
- As fixtures commitadas são **sintéticas** e cobrem os cenários do Adendo §11.
- Um teste "sem vazamento do piloto" carrega o fixture privado, se existir, e verifica que nenhum nome de organização, projeto ou pessoa dele aparece em `apps/**/src` ou `packages/**/src`. É o critério da Fase 0 do Adendo: "nenhum fluxo depende de campos ou nomes exclusivos de Thiago".

## Consequências
- Os textos de política de privacidade e termos são responsabilidade do usuário e da assessoria jurídica. O sistema guarda apenas a versão aceita.
- O backup e a restauração (plano §17) entram na Fase 7, com um procedimento testado contra o cluster local.

## Verificação
Testes:
- exportação contém todas as entidades do dono e nenhuma de outro;
- após excluir a conta, nenhuma linha com o `ownerId` e nenhum arquivo sob o prefixo;
- contexto de IA sem campos privados;
- logs sem canários;
- teste "sem vazamento do piloto".
