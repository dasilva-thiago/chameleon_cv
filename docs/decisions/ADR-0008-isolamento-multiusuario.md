# ADR-0008 — Isolamento multiusuário

**Status:** Aceita (não implementada) · 2026-11-04

## Contexto
O Adendo §6.1 e a Fase 2 exigem que os dados de um usuário jamais apareçam para outro, seja por consulta direta, histórico, busca, arquivo ou geração de IA. O MVP é pequeno, mas multiusuário desde o início. É preciso preparar, sem implementar, os workspaces futuros.

## Decisão
Defesa em camadas, todas obrigatórias no MVP exceto a 6:
1. **`ownerId` em toda tabela privada.** O nome é genérico, não `userId`, para permitir workspaces. Toda tabela tem `@@unique([id, ownerId])`, e **toda FK entre tabelas privadas é composta** `(xId, ownerId)`. Assim, vincular a evidência de A ao fato de B é impossível no banco.
2. **`forOwner(ownerId)`** em `@chameleon/db`: extensão do Prisma Client que injeta `ownerId` em `where` de leitura, `update`, `delete` e `count` (inclusive *where unique* estendido) e em `data` de criação, e que **lança erro** em modelo privado sem escopo. Os repositórios dos módulos só recebem o cliente escopado. O cliente bruto fica restrito a `auth` (lookup de sessão e usuário) e a jobs de manutenção, com lista explícita.
3. **ESLint `no-restricted-imports`** proíbe `@prisma/client` e `$queryRaw` fora de `packages/db`.
4. **Recursos inexistentes e recursos de outro dono respondem igual:** `404` com o mesmo corpo, sem oráculo de existência.
5. **Suíte de isolamento** em `tests/integration/isolation/`, de propriedade da QA:
   - **(a) repositórios:** cada método com ids de B no escopo de A → vazio ou não encontrado;
   - **(b) HTTP:** o gate de cobertura enumera as rotas do Express, e toda rota com parâmetro de recurso precisa de caso cruzado no manifesto, senão o teste falha;
   - **(c) canários:** o usuário B recebe strings únicas `CANARY-B-<uuid>` em todos os campos; após os fluxos de A (listagens, busca, histórico, exportação de dados, contexto de IA, DOCX/PDF, logs capturados), o canário não pode aparecer;
   - **(d) banco:** um INSERT com FK composta cruzada falha;
   - **(e) arquivos:** download do arquivo de B por A dá 404, e path traversal é rejeitado.
6. **RLS do PostgreSQL** (`FORCE ROW LEVEL SECURITY` + `set_config('app.owner_id', ...)` por transação, e um papel de aplicação que não é dono das tabelas): **endurecimento da Fase 7**, avaliado após medir o custo com o Prisma. A viabilidade no cluster local foi verificada (ADR-0002).
7. **Fixtures e piloto** nunca são semeados em contas reais. O seed sintético usa contas de teste dedicadas, e o piloto só vai para uma conta criada explicitamente pelo próprio usuário (ADR-0014).

## Alternativas
- **Só filtro manual por `ownerId` nos repositórios:** frágil, um esquecimento basta para vazar.
- **RLS desde já:** forte, mas aumenta a complexidade de testes, pool e migrações antes de haver código. Por isso fica como endurecimento planejado.
- **Schema/banco por usuário:** desproporcional.

## Consequências
- As FKs compostas deixam o schema Prisma mais verboso.
- Agentes não podem usar `prisma.*` direto nos módulos.

## Verificação
- `pnpm test:integration --project integration -t isolation` verde.
- O gate de rotas falha ao adicionar uma rota sem caso cruzado.
- O lint falha com uma importação proibida.
