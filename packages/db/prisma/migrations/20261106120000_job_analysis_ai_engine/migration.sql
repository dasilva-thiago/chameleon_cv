-- A analise pode ser feita pelo motor local ('deterministic') ou por IA ('ai'): o resultado de cada um fica sob a
-- sua propria versao de motor (chave de cache), sem sobrescrever o outro.
ALTER TABLE "JobAnalysis" DROP CONSTRAINT "JobAnalysis_engine_chk";
ALTER TABLE "JobAnalysis" ADD CONSTRAINT "JobAnalysis_engine_chk"
  CHECK ("engine" IN ('deterministic', 'ai') AND length("engineVersion") BETWEEN 1 AND 40);
