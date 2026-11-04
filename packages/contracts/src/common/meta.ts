import { z } from 'zod';
import { factSourceSchema, factStatusSchema, resumeUseSchema, visibilitySchema } from './enums';
import { fieldStatesSchema, idList, longText, shortText, text } from './primitives';

/**
 * Metadados de governanca de todo registro citavel (domain-model.md 2.3, ADR-0005).
 * O bloco e opcional e NENHUM campo tem default no contrato: os defaults sao aplicados
 * apenas pelo importador (`applyImportDefaults`), que sempre produz `needs_review`.
 */
export const metaSchema = z.strictObject({
  /** Estado de validacao do fato. */
  status: factStatusSchema.nullish(),
  /** Status que o arquivo importado declarava antes de ser rebaixado para `needs_review`. */
  declared_status: factStatusSchema.nullish(),
  visibility: visibilitySchema.nullish(),
  resume_use: resumeUseSchema.nullish(),
  source: factSourceSchema.nullish(),
  source_detail: shortText.nullish(),
  /** Trecho de origem quando extraido (resume_import / ai_extraction). */
  source_excerpt: text.nullish(),
  /** Evidencias que sustentam este fato (ids de `profile.evidence[]`). */
  evidence_ids: idList.nullish(),
  /** Estados explicitos e esparsos por campo (not_applicable, declined, ...). */
  field_states: fieldStatesSchema.nullish(),
  /** Notas privadas: nunca enviadas a IA nem a documentos. */
  private_notes: longText.nullish(),
});
export type Meta = z.infer<typeof metaSchema>;
